import { spawn } from "node:child_process"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { Effect } from "effect"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { League } from "@touchline/league"
import { writeMatch } from "@touchline/sim"
import { DEFAULT_PARAMS } from "@touchline/sim-core"
import { Session } from "@touchline/advisor"
import { modelsFromJson, StatsEngine, StatsQuery, xtGridFromJson } from "@touchline/stats"
import { loadRun } from "../src/load.js"
import { createStatsServer } from "../src/server.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
const pkg = join(root, "packages/mcp-stats")
const xt = xtGridFromJson(JSON.parse(readFileSync(join(root, "data/params/xt-grid.json"), "utf8")))
const models = modelsFromJson(JSON.parse(readFileSync(join(root, "data/params/stats-models.json"), "utf8")))
const league = JSON.parse(readFileSync(join(root, "data/league/league.json"), "utf8")) as League
const dir = mkdtempSync(join(tmpdir(), "touchline-mcp-"))
const cfg = { matchId: "mcp", seed: 4246, kickoffTime: "2026-10-18T14:00:00.000Z", home: league.clubs[4]!, away: league.clubs[5]!, params: DEFAULT_PARAMS, dt: 0.1 }

type ToolResult = { content: Array<{ type: string; text: string }>; isError?: boolean }
let q: StatsQuery
let client: Client
/** A client of a server that can re-simulate (the run rebuilt into a session). */
let advised: Client
const call = async (name: string, args: Record<string, unknown> = {}) => (await client.callTool({ name, arguments: args })) as ToolResult
const data = async (name: string, args: Record<string, unknown> = {}) => {
  const r = await call(name, args)
  expect(r.isError, r.content[0]?.text).toBeFalsy()
  return JSON.parse(r.content[0]!.text)
}

beforeAll(async () => {
  await Effect.runPromise(writeMatch(cfg, dir))
  q = await Effect.runPromise(loadRun(dir, models, { roster: league, xt }))
  const [a, b] = InMemoryTransport.createLinkedPair()
  await createStatsServer(q).connect(a)
  client = new Client({ name: "test", version: "0" })
  await client.connect(b)
  const [c, d] = InMemoryTransport.createLinkedPair()
  await createStatsServer(q, { session: Session.fromRun(dir, league, [DEFAULT_PARAMS]), xt }).connect(c)
  advised = new Client({ name: "advised", version: "0" })
  await advised.connect(d)
}, 120_000)
afterAll(() => client?.close())

describe("MCP stats server", () => {
  it("offer the thirteen read-only tools", async () => {
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual([
      "explain_pass", "get_decision", "get_events", "get_metric", "get_series", "get_signals", "list_metrics", "match_info", "pitch_control", "rank_players", "suggest_position", "verify_claim", "what_if"
    ])
    for (const t of tools) expect(t.annotations?.readOnlyHint, t.name).toBe(true)
  })

  it("answer a metric as the engine does, with a ref to cite, and never past the latest frame", async () => {
    const m = await data("get_metric", { metric_id: "team.press", subject: cfg.home.id, at_frame: 30_000 })
    expect(m.value).toBe(q.engine.value("team.press", cfg.home.id, { at: 30_000 }))
    expect(m).toMatchObject({ unit: "share", as_of_frame: 30_000, from_frame: 27_000, ref: "team.press@27000-30000" })
    const late = await data("get_metric", { metric_id: "shot.xg", subject: cfg.away.id, at_frame: 10_000_000 })
    expect(late.as_of_frame).toBe(q.engine.now)
  })

  it("return a readable tool error for an unknown subject or a metric the subject lacks", async () => {
    const r = await call("get_metric", { metric_id: "pass.acc", subject: "nobody" })
    expect(r.isError).toBe(true)
    expect(r.content[0]!.text).toMatch(/unknown subject "nobody"/)
    expect((await call("get_metric", { metric_id: "plyr.vmax", subject: cfg.home.id })).content[0]!.text).toMatch(/not defined for a team/)
    expect((await call("get_metric", { metric_id: "made.up", subject: "match" })).isError).toBe(true)
  })

  it("give teams with named players and the score as of a frame", async () => {
    const info = await data("match_info")
    expect(info.home.players[0]).toMatchObject({ id: cfg.home.starters[0]!.id, name: (cfg.home.starters[0] as { name?: string }).name, role: "GK" })
    expect(info.score).toEqual(q.engine.score)
    expect((await data("match_info", { at_frame: 0 })).score).toEqual({ home: 0, away: 0 })
  })

  it("list signals and events in a frame range, with derived values and totals", async () => {
    const sig = await data("get_signals", { types: ["goal", "card"], limit: 2 })
    expect(sig.total).toBe(q.engine.signals.filter((s) => s.type === "goal" || s.type === "card").length)
    expect(sig.signals.length).toBe(Math.min(2, sig.total))
    const ev = await data("get_events", { from_frame: 1000, to_frame: 4000, types: ["pass"], team_id: cfg.home.id })
    expect(ev.total).toBeGreaterThan(5)
    for (const e of ev.events) {
      expect(e.frame_id).toBeGreaterThanOrEqual(1000)
      expect(e.team_id).toBe(cfg.home.id)
      // A pass stopped at the passer's feet has length 0.
      expect(e.values["pass.dist"]).toBeGreaterThanOrEqual(0)
      expect(e.values["pass.xp"]).toBeGreaterThan(0)
    }
  })

  it("explain a pass decision, and refuse an event without one", async () => {
    const pass = q.engine.events.find((e) => e.type === "pass" && typeof e.attrs.chosen_rank === "number")!
    const d = await data("get_decision", { event_id: pass.id })
    expect(d).toMatchObject({ event_id: pass.id, chosen_rank: pass.attrs.chosen_rank, best_receiver_id: pass.attrs.best_receiver_id })
    expect(d.options.length).toBeGreaterThan(0)
    const reception = q.engine.events.find((e) => e.type === "reception")!
    expect((await call("get_decision", { event_id: reception.id })).content[0]!.text).toMatch(/no decision record/)
    expect((await call("get_decision", { event_id: "nope" })).isError).toBe(true)
  })

  it("verify a claimed value within tolerance and reject one that is off", async () => {
    const actual = q.engine.value("pass.acc", cfg.away.id, { at: 40_000 })!
    expect((await data("verify_claim", { metric_id: "pass.acc", subject: cfg.away.id, at_frame: 40_000, value: Math.round(actual * 100) / 100 })).verified).toBe(true)
    const off = await data("verify_claim", { metric_id: "pass.acc", subject: cfg.away.id, at_frame: 40_000, value: actual + 0.05 })
    expect(off).toMatchObject({ verified: false, actual })
  })

  it("rank players and give a series", async () => {
    const r = await data("rank_players", { metric_id: "plyr.dist", team_id: cfg.home.id, top: 3 })
    expect(r.players).toHaveLength(3)
    expect(r.players[0].value).toBeGreaterThanOrEqual(r.players[2].value)
    for (const p of r.players) expect(p.team_id).toBe(cfg.home.id)
    const s = await data("get_series", { metric_id: "team.mom", subject: cfg.home.id, from_frame: 0, to_frame: 6000, step_s: 60 })
    expect(s.map((p: { frame: number }) => p.frame)).toEqual(Array.from({ length: 11 }, (_, i) => i * 600))
    expect((await call("get_series", { metric_id: "team.mom", subject: cfg.home.id, step_s: 1 })).content[0]!.text).toMatch(/too many points/)
  })

  it("describe the match as of the frame asked about, not the latest one, with its frame rate", async () => {
    const info = await data("match_info", { at_frame: 30_000 })
    expect(info.as_of_frame).toBe(30_000)
    expect(info.latest).toMatchObject({ frame: 30_000 })
    expect(info.latest.period).toBe(q.engine.events.find((e) => e.type === "period_start" && e.attrs.period === "second_half")!.frame_id <= 30_000 ? "second_half" : "first_half")
    expect(info).toMatchObject({ dt: 0.1, fps: 10 })
    expect(client.getInstructions()).toContain("10 per second")
    const fast = new Client({ name: "fast", version: "0" })
    const [a, b] = InMemoryTransport.createLinkedPair()
    await createStatsServer(new StatsQuery(new StatsEngine({ ...q.engine.info, dt: 0.04 }, models))).connect(a)
    await fast.connect(b)
    expect(fast.getInstructions()).toContain("25 per second")
    await fast.close()
  })

  it("never let the caller loosen the claim tolerance beyond the default", async () => {
    const actual = q.engine.value("pass.acc", cfg.away.id, { at: 40_000 })!
    const loose = await data("verify_claim", { metric_id: "pass.acc", subject: cfg.away.id, at_frame: 40_000, value: 99, tolerance: 1e9 })
    expect(loose.verified).toBe(false)
    const tight = await data("verify_claim", { metric_id: "pass.acc", subject: cfg.away.id, at_frame: 40_000, value: actual + 0.002, tolerance: 0.001 })
    expect(tight.verified).toBe(false)
  })

  it("refuse unknown team and player ids and event types in filters instead of answering with nothing", async () => {
    expect((await call("get_events", { team_id: "nobody-fc" })).content[0]!.text).toMatch(/unknown team "nobody-fc"/)
    expect((await call("get_events", { player_id: "p-nobody" })).content[0]!.text).toMatch(/unknown player "p-nobody"/)
    expect((await call("get_signals", { team_id: "nobody-fc" })).isError).toBe(true)
    expect((await call("rank_players", { metric_id: "plyr.dist", team_id: "nobody-fc" })).isError).toBe(true)
    expect((await call("get_events", { types: ["shoot"] })).isError).toBe(true)
  })

  it("map pitch control for either team, the two maps adding up to the whole pitch", async () => {
    const home = await data("pitch_control", { team_id: cfg.home.id, at_frame: 30_005 })
    const away = await data("pitch_control", { team_id: cfg.away.id, at_frame: 30_005 })
    expect(home).toMatchObject({ as_of_frame: 30_005, sample_frame: 30_000, cols: 21, rows: 14 })
    expect(home.control).toHaveLength(294)
    expect(home.share + away.share).toBeCloseTo(1, 3)
    expect((await call("pitch_control", { team_id: "nobody-fc" })).isError).toBe(true)
  })

  it("re-simulate what-ifs from a frame, refusing frames past the latest and servers that cannot", async () => {
    const at = q.engine.events.find((e) => e.type === "pass" && e.frame_id > 20_000)!.frame_id - 1
    const call2 = async (name: string, args: Record<string, unknown>) => (await advised.callTool({ name, arguments: args })) as ToolResult
    const same = JSON.parse((await call2("what_if", { at_frame: at, intervention: { kind: "none" }, seeds: 4, horizon_s: 5 })).content[0]!.text)
    expect(same.difference.total).toEqual({ mean: 0, se: 0 })
    const press = JSON.parse((await call2("what_if", { at_frame: at, intervention: { kind: "tactic", team_id: cfg.away.id, style: { pressIntensity: 1 } }, team_id: cfg.home.id, seeds: 4, horizon_s: 5 })).content[0]!.text)
    expect(press).toMatchObject({ team_id: cfg.home.id, seeds: 4, horizon_s: 5, at_tick: at })
    expect((await call2("what_if", { at_frame: q.engine.now + 10, intervention: { kind: "none" } })).content[0]!.text).toMatch(/later than the latest frame/)
    expect((await call("what_if", { at_frame: at, intervention: { kind: "none" } })).content[0]!.text).toMatch(/not available/)
  })

  it("explain a pass and suggest a position through the re-simulation tools", async () => {
    const pass = q.engine.events.find((e) => e.type === "pass" && e.frame_id > 20_000 && (e.attrs.options as unknown[]).length >= 3)!
    const x = JSON.parse(((await advised.callTool({ name: "explain_pass", arguments: { event_id: pass.id, seeds: 4 } })) as ToolResult).content[0]!.text)
    expect(x.event_id).toBe(pass.id)
    expect(["played_pass_was_best", "better_option_found", "not_verified"]).toContain(x.verdict)
    const mate = cfg.home.starters[5]!.id
    let t = 20_000
    while (true) {
      const r = (await advised.callTool({ name: "suggest_position", arguments: { player_id: mate, at_frame: t } })) as ToolResult
      if (!r.isError) {
        expect(["attack", "defend"]).toContain(JSON.parse(r.content[0]!.text).mode)
        break
      }
      t += 50
    }
  })

  it("load a match as it stood at a given minute", async () => {
    const at30 = await Effect.runPromise(loadRun(dir, models, { minute: 30 }))
    expect(at30.engine.now).toBe(18_000)
    expect(at30.engine.eventTicks.every((t) => t <= 18_000)).toBe(true)
    const at60 = await Effect.runPromise(loadRun(dir, models, { minute: 60 }))
    expect(at60.engine.frame!.period).toBe("second_half")
    expect(at60.engine.frame!.frame_id).toBe(9_000)
  })

  it("serve over stdio from the command line", async () => {
    const c = new Client({ name: "stdio-test", version: "0" })
    await c.connect(new StdioClientTransport({ command: "npx", args: ["tsx", "src/cli.ts", "--run", dir, "--minute", "60"], cwd: pkg, stderr: "ignore" }))
    const r = (await c.callTool({ name: "get_metric", arguments: { metric_id: "team.poss", subject: cfg.home.id } })) as ToolResult
    expect(JSON.parse(r.content[0]!.text).as_of_frame).toBeGreaterThan(30_000)
    await c.close()
  }, 60_000)

  it("serve Streamable HTTP on 127.0.0.1 from the command line", async () => {
    const child = spawn("npx", ["tsx", "src/cli.ts", "--run", dir, "--http", "0"], { cwd: pkg })
    try {
      const url = await new Promise<string>((ok, bad) => {
        child.stderr.on("data", (b: Buffer) => {
          const m = /(http:\/\/127\.0\.0\.1:\d+\/mcp)/.exec(String(b))
          if (m) ok(m[1]!)
        })
        child.on("exit", (code) => bad(new Error(`exited ${code}`)))
      })
      const c = new Client({ name: "http-test", version: "0" })
      await c.connect(new StreamableHTTPClientTransport(new URL(url)))
      const info = JSON.parse(((await c.callTool({ name: "match_info", arguments: {} })) as ToolResult).content[0]!.text)
      expect(info.match_id).toBe("mcp")
      await c.close()
    } finally {
      child.kill()
    }
  }, 60_000)
})
