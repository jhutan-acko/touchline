import { useEffect, useReducer } from "react"
import type { Tick } from "@touchline/rpc"
import type { Segment } from "@touchline/schema"
import type { TouchlineClient } from "./client.js"
import { EMPTY, reduce, type PaneState } from "./pane.js"

/** A pane's state for one segment of a session, updated by every tick. */
export const usePane = (client: TouchlineClient, sessionId: string, segment: Segment): PaneState => {
  const [state, dispatch] = useReducer((s: PaneState, t: Tick) => reduce(s, t, Date.now()), EMPTY)
  const key = `${segment.mode}.${segment.lang}.${segment.club ?? ""}`
  useEffect(() => client.watch(sessionId, segment, dispatch), [client, sessionId, key])
  return state
}
