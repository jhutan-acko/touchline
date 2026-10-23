/**
 * Pause-and-ask requests: the question agent's intent (one artifact) and the answer team's stages and reply (a stream),
 * each with a time limit and every artifact checked against its contract. Ask runs on its own path: never the live
 * budget or `exchange()`.
 */
import { Cause, Effect, Queue, Schema, Stream } from "effect"
import { AskIntent, AskReply, AskStage, type AskAnswerRequest, type AskIntentRequest } from "@touchline/schema"
import { TaskFailed, type Sender } from "./a2a.js"
import { AgentFailed, AgentUnavailable, InvalidArtifact } from "./gateway.js"

const decodeIntent = Schema.decodeUnknownSync(AskIntent)
const decodeStage = Schema.decodeUnknownSync(AskStage)
const decodeReply = Schema.decodeUnknownSync(AskReply)

const decode = <A>(name: string, f: (u: unknown) => A, data: unknown): A => {
  try {
    return f(data)
  } catch (e) {
    throw new InvalidArtifact({ name, reason: e instanceof Error ? e.message.split("\n")[0]! : String(e) })
  }
}

const failure = (e: unknown) =>
  e instanceof InvalidArtifact ? e : e instanceof TaskFailed ? new AgentFailed({ reason: e.message }) : new AgentUnavailable({ reason: e instanceof Error ? e.message : String(e) })

export type AskError = AgentUnavailable | AgentFailed | InvalidArtifact | Cause.TimeoutError

/** Classify a viewer's question; fails with AgentUnavailable (after one more try), AgentFailed, InvalidArtifact or a TimeoutError. */
export const askIntent = (send: Sender, req: typeof AskIntentRequest.Type, timeoutMs: number): Effect.Effect<AskIntent, AskError> =>
  Effect.tryPromise({
    try: async (signal): Promise<AskIntent> => {
      let intent: AskIntent | undefined
      for await (const a of send(req, signal)) {
        if (a.name !== "ask_intent") throw new InvalidArtifact({ name: a.name, reason: "an ask_intent request answers with an ask_intent artifact" })
        intent = decode("ask_intent", decodeIntent, a.data)
      }
      if (!intent) throw new InvalidArtifact({ name: "ask_intent", reason: "no ask_intent artifact" })
      return intent
    },
    catch: failure
  }).pipe(Effect.timeout(`${timeoutMs} millis`), Effect.retry({ times: 1, while: (e) => e._tag === "AgentUnavailable" }))

export type AskAnswerItem = { readonly kind: "stage"; readonly stage: AskStage } | { readonly kind: "reply"; readonly reply: AskReply }

/**
 * The answer team's stages as they come, then its reply (decoded `ask_stage` and `ask_reply` artifacts), all within
 * `timeoutMs`. Fails with AgentUnavailable, AgentFailed, InvalidArtifact (also when no reply comes) or a TimeoutError;
 * stages already sent stay sent.
 */
export const askAnswer = (send: Sender, req: typeof AskAnswerRequest.Type, timeoutMs: number): Stream.Stream<AskAnswerItem, AskError> =>
  Stream.callback<AskAnswerItem, AskError>((queue) =>
    Effect.tryPromise({
      try: async (signal) => {
        let replied = false
        for await (const a of send(req, signal)) {
          if (replied) throw new InvalidArtifact({ name: a.name, reason: "nothing may follow the ask_reply artifact" })
          if (a.name === "ask_stage") Queue.offerUnsafe(queue, { kind: "stage", stage: decode("ask_stage", decodeStage, a.data) })
          else if (a.name === "ask_reply") {
            Queue.offerUnsafe(queue, { kind: "reply", reply: decode("ask_reply", decodeReply, a.data) })
            replied = true
          } else throw new InvalidArtifact({ name: a.name, reason: "an ask_answer request answers with ask_stage and ask_reply artifacts" })
        }
        if (!replied) throw new InvalidArtifact({ name: "ask_reply", reason: "no ask_reply artifact" })
      },
      catch: failure
    }).pipe(
      Effect.timeout(`${timeoutMs} millis`),
      Effect.matchEffect({ onFailure: (e) => Queue.fail(queue, e), onSuccess: () => Queue.end(queue) })
    )
  )
