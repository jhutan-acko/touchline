import { useEffect, useReducer, useState } from "react"
import type { Tick } from "@touchline/rpc"
import type { Segment } from "@touchline/schema"
import type { TouchlineClient } from "./client.js"
import { FOLLOW_EMPTY, followReduce, isEventTick, type FollowState } from "./follow.js"
import { EMPTY, reduce, type PaneState } from "./pane.js"

/** How a pane's watch stands: fine, lost and being retried, or over because the session is gone. */
export type Connection = "ok" | "retrying" | "gone"

/** Watch attempts after a lost connection (1 s, 2 s, 4 s, 8 s, 16 s apart) before the pane gives up. */
export const RETRIES = 5

/**
 * A pane's state for one segment of a session, updated by every tick; a broken watch is retried with backoff.
 * `fps` is the match's frame rate (cue ttls are counted in frames). `source` picks the stream: the fan view (`watch`) or
 * the broadcast graphics output (`graphics`).
 */
export const usePane = (client: TouchlineClient, sessionId: string, segment: Segment, fps: number, source: "watch" | "graphics" = "watch"): PaneState & { readonly connection: Connection; readonly follow: FollowState } => {
  // On-ball event ticks are kept once, in follow.ts (the players' numbers and the stat tags read them there).
  const [state, dispatch] = useReducer(
    (s: { pane: PaneState; follow: FollowState }, t: Tick) => ({
      pane: isEventTick(t) ? s.pane : (reduce(s.pane, t, fps) ?? s.pane),
      follow: followReduce(s.follow, t, fps)
    }),
    { pane: EMPTY, follow: FOLLOW_EMPTY }
  )
  const [connection, setConnection] = useState<Connection>("ok")
  const key = `${segment.mode}.${segment.lang}.${segment.club ?? ""}`
  useEffect(() => {
    let alive = true
    let attempt = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    let stop = () => {}
    const start = () => {
      stop = client[source](
        sessionId,
        segment,
        (t) => {
          attempt = 0
          setConnection("ok")
          dispatch(t)
        },
        (error) => {
          if (!alive || error === null) return // unmounted, or the session closed normally
          if (error.includes("SessionNotFound") || attempt >= RETRIES) return setConnection("gone")
          setConnection("retrying")
          timer = setTimeout(start, 1000 * 2 ** attempt++)
        }
      )
    }
    start()
    return () => {
      alive = false
      clearTimeout(timer)
      stop()
    }
  }, [client, sessionId, key, source])
  return { ...state.pane, follow: state.follow, connection }
}
