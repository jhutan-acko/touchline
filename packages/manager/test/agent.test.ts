import { Effect } from "effect"
import type { Artifact, Sender } from "@touchline/agent-gateway"
import { decodeDecision, type AgentRequest, type ManageRequest, type ManagerReply } from "@touchline/schema"
import { describe, expect, it } from "vitest"
import { agentManager } from "../src/agent.js"
import type { DecideInput } from "../src/decision.js"
import { replayManager } from "../src/replay.js"
import { runManaged } from "../src/run.js"
import { situationAt, situationHash } from "../src/situation.js"
import { leagueConfig, models, playMoments, xt } from "./helpers.js"

const whatif = { seeds: 2, horizonS: 30, runner: "inline" as const }
const run = playMoments(leagueConfig(11), (m) => m.reasons.includes("minute_60"))
const m = run.moments.at(-1)!
const situation = situationAt(m.state, "home", m.reasons, run.watch)
const input: DecideInput = { state: m.state, side: "home", reasons: m.reasons, situation, situationHash: situationHash(situation) }
const striker = situation.players.on_pitch.find((p) => p.role === "ST")!
const freshStriker = situation.players.bench.find((b) => b.role === "ST")!

const reply = (over: Partial<ManagerReply> & Pick<ManagerReply, "task">): ManagerReply => ({
  proposal: null, choice: null, fallback: false, reason: null, ms: 5, tokens_in: 100, tokens_out: 10, cost_usd: 0.001, model: "openai:test", ...over
})
const PROPOSAL = reply({
  task: "propose",
  proposal: { options: [
    { label: "Press higher", orders: [{ kind: "style", setting: "pressIntensity", value: 1 }], rationale: "Win it back sooner." },
    { label: "Fresh striker", orders: [{ kind: "sub", off: striker.id, on: freshStriker.id }], rationale: "Tired legs up front." }
  ] }
})
/** The tested option with the best xG gain, as the stub model chooses. */
const best = (req: ManageRequest) => {
  const tested = req.whatif!.options.filter((o) => o.index > 0 && !o.untested)
  return tested.sort((a, b) => b.xg_diff_vs_no_change!.mean - a.xg_diff_vs_no_change!.mean)[0]!
}

/** A fake manager service: `propose` and `choose` answers (or errors), and every request it got. */
const service = (answers: { propose?: (r: ManageRequest) => ManagerReply | Error; choose?: (r: ManageRequest) => ManagerReply | Error } = {}): Sender & { calls: ManageRequest[] } => {
  const calls: ManageRequest[] = []
  return Object.assign(async function* (req: AgentRequest): AsyncGenerator<Artifact> {
    const r = req as ManageRequest
    calls.push(r)
    const answer = r.task === "propose" ? (answers.propose ?? (() => PROPOSAL))(r) : (answers.choose ?? ((q) => reply({ task: "choose", choice: { pick: best(q).index, reason: `${best(q).label} did best.` } })))(r)
    if (answer instanceof Error) throw answer
    yield { name: "manager", data: answer }
  }, { calls })
}
const decide = (send: Sender) => Effect.runPromise(agentManager(send, { whatif }).decide(input))

describe("the agent manager", () => {
  it("proposes, tests every option against no change, and applies the agent's choice", async () => {
    const send = service()
    const d = await decide(send)
    expect(send.calls.map((c) => c.task)).toEqual(["propose", "choose"])
    expect(send.calls[0]!.situation).toEqual(situation)
    expect(d.options.map((o) => [o.index, o.label, o.source])).toEqual([[0, "No change", "no_change"], [1, "Press higher", "agent"], [2, "Fresh striker", "agent"]])
    expect(d.options.slice(1).every((o) => o.xg_diff_vs_no_change !== null && !o.untested)).toBe(true)
    // The agent was shown exactly the tested numbers, rounded.
    expect(send.calls[1]!.whatif!.options.map((o) => o.index)).toEqual([0, 1, 2])
    expect(d.pick).toBe(best(send.calls[1]!).index)
    expect(d.orders_applied).toEqual(d.options[d.pick]!.orders)
    expect([d.fallback, d.tokens, d.cost_usd, d.model, d.manager]).toEqual([null, { in: 200, out: 20 }, 0.002, "openai:test", "agent"])
    expect(decodeDecision(d)).toEqual(d)
  })
  it("stands the rule-based option in when the agent cannot propose, and still lets it choose", async () => {
    const lostSituation = { ...situation, moment: { ...situation.moment, score: { for: 0, against: 2 }, score_state: "losing by 2" } }
    const send = service({ propose: () => reply({ task: "propose", fallback: true, reason: "timeout" }) })
    const d = await Effect.runPromise(agentManager(send, { whatif }).decide({ ...input, situation: lostSituation }))
    expect(d.fallback).toBe("propose")
    expect(d.options.map((o) => o.source)).toEqual(["no_change", "rules"])
    expect(send.calls.map((c) => c.task)).toEqual(["propose", "choose"])
  })
  it("drops orders the live state refuses, with the reason, and treats a proposal with none left as failed", async () => {
    const bad = reply({ task: "propose", proposal: { options: [{ label: "Ghost", orders: [{ kind: "sub", off: "nobody", on: freshStriker.id }], rationale: "?" }] } })
    const d = await decide(service({ propose: () => bad }))
    expect(d.fallback).toBe("propose")
    expect(d.options.every((o) => o.source !== "agent")).toBe(true)
    const kept = await Effect.runPromise(agentManager(service({ propose: () => reply({ task: "propose", proposal: { options: [...PROPOSAL.proposal!.options, bad.proposal!.options[0]!] } }) }), { whatif }).decide(input))
    expect(kept.options[3]!.dropped).toEqual([{ order: { kind: "sub", off: "nobody", on: freshStriker.id }, reason: "nobody is not on the pitch for this team" }])
  })
  it("keeps the previous plan when the agent cannot choose, or picks an option that was not tested", async () => {
    for (const choose of [() => reply({ task: "choose", fallback: true, reason: "invalid" }), () => reply({ task: "choose", choice: { pick: 9, reason: "?" } })]) {
      const d = await decide(service({ choose }))
      expect([d.pick, d.fallback, d.orders_applied]).toEqual([0, "choose", []])
      expect(d.options).toHaveLength(3)
    }
  })
  it("keeps the previous plan when the service cannot be reached, and stops asking for a while after repeated failures", async () => {
    const down = service({ propose: () => new Error("ECONNREFUSED") })
    const mgr = agentManager(down, { whatif, breaker: { failures: 2, cooldown: 2 } })
    const ds = []
    for (let i = 0; i < 5; i++) ds.push(await Effect.runPromise(mgr.decide(input)))
    expect(ds.map((d) => [d.pick, d.fallback])).toEqual(Array(5).fill([0, "service"]))
    // Two failures (each tried twice by the gateway), two skipped decisions, then the service is asked again.
    expect(down.calls).toHaveLength(6)
  })
})

describe("a match managed by the agent", () => {
  it("logs its decisions and replays bit-identically without calling the agent", async () => {
    const cfg = leagueConfig(11)
    const send = service()
    const managed = await Effect.runPromise(runManaged(cfg, { home: agentManager(send, { whatif }) }, { models, xt }))
    expect(managed.decisions.length).toBeGreaterThanOrEqual(3)
    expect(managed.decisions.every((d) => d.side === "home" && d.manager === "agent")).toBe(true)
    const calls = send.calls.length
    const replay = await Effect.runPromise(runManaged(cfg, { home: replayManager(managed.decisions) }, { models, xt }))
    expect(replay.events).toEqual(managed.events)
    expect(send.calls).toHaveLength(calls)
  })
})
