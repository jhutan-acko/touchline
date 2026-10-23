import { readFileSync } from "node:fs"
import { join } from "node:path"
import { Effect, Exit, Stream } from "effect"
import type { AgentRequest, AskAnswerRequest, AskIntentRequest } from "@touchline/schema"
import { describe, expect, it } from "vitest"
import type { Artifact, Sender } from "../src/a2a.js"
import { askAnswer, askIntent } from "../src/ask.js"
import { root } from "../src/replay.js"

const fixture = (name: string) => (JSON.parse(readFileSync(join(root, "packages/schema/fixtures/agents/valid", name), "utf8")) as { value: unknown }).value
const ANSWER_REQ = fixture("ask-answer-request.json") as typeof AskAnswerRequest.Type
const INTENT_REQ = fixture("ask-intent-request.json") as typeof AskIntentRequest.Type
const STAGE = fixture("ask-stage.json") as { stage: string; status: string }
const REPLY = fixture("ask-reply.json") as { headline: string }
const INTENT = fixture("ask-intent.json")

const sender = (out: Artifact[] | Error): Sender & { calls: AgentRequest[] } => {
  const calls: AgentRequest[] = []
  return Object.assign(async function* (req: AgentRequest) {
    calls.push(req)
    if (out instanceof Error) throw out
    yield* out
  }, { calls })
}
const failure = (exit: Exit.Exit<unknown, unknown>) => (Exit.isFailure(exit) ? JSON.stringify(exit.cause) : "")

describe("ask requests", () => {
  it("decodes stage and reply artifacts in order", async () => {
    const send = sender([
      { name: "ask_stage", data: { stage: "analyst", status: "Looking at the play" } },
      { name: "ask_stage", data: STAGE },
      { name: "ask_reply", data: REPLY }
    ])
    const items = await Effect.runPromise(Stream.runCollect(askAnswer(send, ANSWER_REQ, 1000)))
    expect(items.map((i) => (i.kind === "stage" ? i.stage.stage : "reply"))).toEqual(["analyst", STAGE.stage, "reply"])
    const last = items.at(-1)!
    expect(last.kind === "reply" ? last.reply.headline : null).toBe(REPLY.headline)
    expect(send.calls).toEqual([ANSWER_REQ])
    const intent = await Effect.runPromise(askIntent(sender([{ name: "ask_intent", data: INTENT }]), INTENT_REQ, 1000))
    expect(intent).toEqual(INTENT)
  })

  it("rejects a malformed reply as InvalidArtifact", async () => {
    const bad = sender([{ name: "ask_stage", data: STAGE }, { name: "ask_reply", data: { ...REPLY, chips: "none" } }])
    expect(failure(await Effect.runPromiseExit(Stream.runCollect(askAnswer(bad, ANSWER_REQ, 1000))))).toContain("InvalidArtifact")
    expect(failure(await Effect.runPromiseExit(Stream.runCollect(askAnswer(sender([{ name: "ask_stage", data: STAGE }]), ANSWER_REQ, 1000))))).toContain("no ask_reply artifact")
    expect(failure(await Effect.runPromiseExit(askIntent(sender([{ name: "ask_intent", data: { kind: "maybe" } }]), INTENT_REQ, 1000)))).toContain("InvalidArtifact")
    const down = sender(new Error("ECONNREFUSED"))
    expect(failure(await Effect.runPromiseExit(askIntent(down, INTENT_REQ, 1000)))).toContain("AgentUnavailable")
    expect(down.calls).toHaveLength(2)
  })
})
