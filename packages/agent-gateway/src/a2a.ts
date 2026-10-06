import { randomUUID } from "node:crypto"
import { Role, TaskState } from "@a2a-js/sdk"
import { ClientFactory, type Client } from "@a2a-js/sdk/client"
import type { AgentRequest } from "@touchline/schema"

/** An artifact the agent service streamed back: its name ("cue", "trace", "recap") and its JSON data. */
export interface Artifact {
  readonly name: string
  readonly data: unknown
}

/** The agent service ran the request and failed it (a bad request, or an error inside the workflow). */
export class TaskFailed extends Error {}

/**
 * Sends one request and streams back its artifacts; throws TaskFailed when the task fails, and any other error when
 * the service cannot be reached. Gateway tests use fakes; `a2aSender` is the real one.
 */
export type Sender = (req: AgentRequest, signal: AbortSignal) => AsyncIterable<Artifact>

type Payload = { readonly $case: string; readonly value: any }

/** An A2A v1.0 client of the agent service at `agentsUrl` (the agent card is read from its well-known path). */
export const a2aSender = (agentsUrl: string): Sender => {
  let client: Promise<Client> | undefined
  const connect = () => (client ??= new ClientFactory().createFromUrl(new URL(".well-known/agent-card.json", agentsUrl).href, "").catch((e) => {
    client = undefined
    throw e
  }))
  return async function* (req, signal) {
    const c = await connect()
    const message = {
      messageId: randomUUID(), contextId: "", taskId: "", role: Role.ROLE_USER,
      parts: [{ content: { $case: "data", value: req }, metadata: undefined, filename: "", mediaType: "application/json" }],
      metadata: undefined, extensions: [], referenceTaskIds: []
    }
    const stream = c.sendMessageStream({ tenant: "", message, configuration: undefined, metadata: undefined } as never, { signal } as never)
    for await (const ev of stream) {
      const p = ev.payload as Payload | undefined
      if (!p) continue
      if (p.$case === "artifactUpdate") {
        const a = p.value.artifact
        for (const part of a?.parts ?? []) if (part.content?.$case === "data") yield { name: a.name, data: part.content.value }
      } else if ((p.$case === "statusUpdate" || p.$case === "task") && p.value.status?.state === TaskState.TASK_STATE_FAILED) {
        const text = (p.value.status.message?.parts ?? []).map((x: { content?: Payload }) => (x.content?.$case === "text" ? x.content.value : "")).join(" ")
        throw new TaskFailed(text || "the agent task failed")
      }
    }
  }
}
