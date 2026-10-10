import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { League } from "@touchline/league"
import { decodeDecision, decodeDomainEvent } from "@touchline/schema"
import { paramsFromJson } from "@touchline/sim-core"
import { AdvisorError, Session } from "../src/index.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
const json = (p: string) => JSON.parse(readFileSync(join(root, p), "utf8"))
const league = json("data/league/league.json") as League
const params = paramsFromJson(json("data/params/touchline-params.json"))
const lines = (file: string) => readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l))

let dir: string
beforeAll(() => {
  dir = join(mkdtempSync(join(tmpdir(), "advisor-managed-")), "m")
  const r = spawnSync("pnpm", ["-s", "manage", "--seed", "11", "--home-manager", "rules", "--away-manager", "rules", "--out", dir], { cwd: root, encoding: "utf8" })
  if (r.status !== 0) throw new Error(r.stderr)
}, 300_000)
afterAll(() => rmSync(dirname(dir), { recursive: true, force: true }))

describe("a managed match's run folder", () => {
  it("is rebuilt with its managers' orders: every state matches the match as it was played", () => {
    const session = Session.fromRun(dir, league, [params])
    expect(session.cfg.managed).toEqual(["home", "away"])
    const decisions = lines(join(dir, "decisions.jsonl")).map((l) => decodeDecision(l))
    expect(session.logged.length).toBe(decisions.length)
    const events = lines(join(dir, "domain.jsonl")).map((l) => decodeDomainEvent(l))
    // After the last decision, the rebuilt match has emitted exactly the run's events.
    const after = decisions.at(-1)!.tick + 600
    const last = events.filter((e) => Math.max(e.frame_id, e.frame_id_end ?? e.frame_id) <= after).reduce((m, e) => Math.max(m, Number(e.id.split("-e").at(-1))), 0)
    expect(session.stateAt(after).eventSeq).toBe(last)
    // A substitution a manager ordered is on the pitch in the rebuilt state.
    const sub = decisions.flatMap((d) => d.orders_applied).find((o) => o.kind === "sub") as { on: string } | undefined
    expect(sub && session.stateAt(after).players.some((p) => p.id === sub.on)).toBe(true)
  })
  it("cannot be rebuilt without its decision log", () => {
    rmSync(join(dir, "decisions.jsonl"))
    expect(() => Session.fromRun(dir, league, [params])).toThrow(AdvisorError)
  })
})
