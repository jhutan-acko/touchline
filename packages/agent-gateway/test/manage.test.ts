import { readFileSync } from "node:fs"
import { join } from "node:path"
import { Effect, Exit } from "effect"
import type { AgentRequest, ManageRequest } from "@touchline/schema"
import { describe, expect, it } from "vitest"
import type { Artifact, Sender } from "../src/a2a.js"
import { manage } from "../src/manage.js"
import { root } from "../src/replay.js"

const fixture = (name: string) => (JSON.parse(readFileSync(join(root, "packages/schema/fixtures/agents/valid", name), "utf8")) as { value: unknown }).value
const REQ = fixture("request-manage-propose.json") as ManageRequest
const REPLY = fixture("manager-reply.json")

/** A sender answering manage requests with `answer(n)` (n counts calls). */
const sender = (answer: (n: number) => Artifact[] | Error, delayMs = 0): Sender & { calls: AgentRequest[] } => {
  const calls: AgentRequest[] = []
  return Object.assign(async function* (req: AgentRequest) {
    calls.push(req)
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs))
    const out = answer(calls.length)
    if (out instanceof Error) throw out
    yield* out
  }, { calls })
}
const failure = (exit: Exit.Exit<unknown, { _tag: string }>) => (Exit.isFailure(exit) ? JSON.stringify(exit.cause) : "")

describe("a manage request", () => {
  it("returns the decoded manager reply", async () => {
    const reply = await Effect.runPromise(manage(sender(() => [{ name: "manager", data: REPLY }]), REQ, 1000))
    expect(reply.proposal!.options[0]!.label).toBe("Fresh striker, press higher")
  })
  it("is tried once more when the service cannot be reached, and not when it answers wrongly", async () => {
    const flaky = sender((n) => (n === 1 ? new Error("ECONNREFUSED") : [{ name: "manager", data: REPLY }]))
    await Effect.runPromise(manage(flaky, REQ, 1000))
    expect(flaky.calls).toHaveLength(2)
    const wrong = sender(() => [{ name: "cue", data: {} }])
    expect(failure(await Effect.runPromiseExit(manage(wrong, REQ, 1000)))).toContain("InvalidArtifact")
    expect(wrong.calls).toHaveLength(1)
  })
  it("fails on a reply that breaks the contract, answers another task or never comes", async () => {
    const bad = { ...(REPLY as object), proposal: { options: [] } }
    expect(failure(await Effect.runPromiseExit(manage(sender(() => [{ name: "manager", data: bad }]), REQ, 1000)))).toContain("InvalidArtifact")
    const other = { ...(REPLY as object), task: "choose", proposal: null, choice: { pick: 0, reason: "x" } }
    expect(failure(await Effect.runPromiseExit(manage(sender(() => [{ name: "manager", data: other }]), REQ, 1000)))).toContain("answered choose")
    expect(failure(await Effect.runPromiseExit(manage(sender(() => []), REQ, 1000)))).toContain("no manager artifact")
    expect(failure(await Effect.runPromiseExit(manage(sender(() => [{ name: "manager", data: REPLY }], 300), REQ, 50)))).toContain("TimeoutError")
  })
})
