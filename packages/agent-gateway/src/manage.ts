/**
 * Manage requests (Plan 4b): one manager agent call over A2A, with a time limit, one retry when the service cannot be
 * reached, and the reply checked against its contract. A reply that is a fallback is still a reply: the caller decides.
 */
import { Effect } from "effect"
import { decodeManagerReply, type ManageRequest, type ManagerReply } from "@touchline/schema"
import { TaskFailed, type Sender } from "./a2a.js"
import { AgentFailed, AgentUnavailable, InvalidArtifact } from "./gateway.js"

/** Ask the manager agent; fails with AgentUnavailable, AgentFailed, InvalidArtifact or a TimeoutError. */
export const manage = (send: Sender, req: ManageRequest, timeoutMs: number) =>
  Effect.tryPromise({
    try: async (signal): Promise<ManagerReply> => {
      let reply: ManagerReply | undefined
      for await (const a of send(req, signal)) {
        if (a.name !== "manager") throw new InvalidArtifact({ name: a.name, reason: "a manage request answers with a manager artifact" })
        try {
          reply = decodeManagerReply(a.data)
        } catch (e) {
          throw new InvalidArtifact({ name: "manager", reason: e instanceof Error ? e.message.split("\n")[0]! : String(e) })
        }
      }
      if (!reply) throw new InvalidArtifact({ name: "manager", reason: "no manager artifact" })
      if (reply.task !== req.task) throw new InvalidArtifact({ name: "manager", reason: `asked to ${req.task}, answered ${reply.task}` })
      return reply
    },
    catch: (e) =>
      e instanceof InvalidArtifact ? e : e instanceof TaskFailed ? new AgentFailed({ reason: e.message }) : new AgentUnavailable({ reason: e instanceof Error ? e.message : String(e) })
  }).pipe(Effect.timeout(`${timeoutMs} millis`), Effect.retry({ times: 1, while: (e) => e._tag === "AgentUnavailable" }))
