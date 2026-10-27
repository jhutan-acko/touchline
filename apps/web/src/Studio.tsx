import { useEffect, useState } from "react"
import type { Playback, QueueItem, QueueStatus, StudioAction } from "@touchline/rpc"
import type { Cue, Segment } from "@touchline/schema"
import type { TouchlineClient } from "./client.js"
import { t, type Key } from "./i18n.js"
import { RETRIES, type Connection } from "./usePane.js"

const STATUS: Record<QueueStatus, { key: Key; style: string }> = {
  pending: { key: "pending", style: "bg-slate-700" },
  approved: { key: "approved", style: "bg-sky-700" },
  held: { key: "held", style: "bg-amber-700" },
  on_air: { key: "onAir", style: "bg-red-600" }
}
const AFTER: Record<StudioAction, QueueStatus> = { approve: "approved", hold: "held", send: "on_air" }
export const RAW_FEED_SIZE = 100

/**
 * The studio console (spec §5.6): the producer's queue of moments (approve, hold, send to graphics), the presenter's
 * talking points for approved and on-air moments, and the raw feed of every agent cue. Decisions are shared: every
 * console on the session sees them.
 */
export const Studio = ({ client, session, segment }: { client: TouchlineClient; session: string; segment: Segment }) => {
  const lang = segment.lang
  const [queue, setQueue] = useState<ReadonlyMap<string, QueueItem>>(new Map())
  const [feed, setFeed] = useState<ReadonlyArray<Cue>>([])
  const [playback, setPlayback] = useState<Playback | null>(null)
  const [connection, setConnection] = useState<Connection>("ok")
  const upsert = (item: QueueItem) => setQueue((q) => new Map([...q, [item.moment_id, item]]))
  // Follow the session; a lost connection is retried with backoff (the server resends the queue), keeping what is on screen.
  useEffect(() => {
    let alive = true
    let attempt = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    let stop = () => {}
    const start = () => {
      stop = client.studio(
        session,
        segment,
        (tick) => {
          attempt = 0
          setConnection("ok")
          if (tick.kind === "queue") upsert(tick.item)
          else if (tick.kind === "cue") setFeed((f) => [tick.cue, ...f].slice(0, RAW_FEED_SIZE))
          else setPlayback(tick.playback)
        },
        (error) => {
          if (!alive || error === null) return
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
  }, [client, session, segment.mode, segment.lang, segment.club])
  const decide = (item: QueueItem, action: StudioAction) => {
    upsert({ ...item, status: AFTER[action] }) // shown at once; the stream confirms it for everyone
    client.act(session, item.moment_id, action).then(
      (r) => setQueue((q) => new Map([...q, [r.moment_id, { ...q.get(r.moment_id)!, status: r.status }]])),
      () => upsert(item)
    )
  }
  // The session's own pause, for everyone watching it (a fan's Pause only freezes their own picture).
  const togglePlayback = () =>
    client.control(session, playback?.state === "paused" ? "play" : "pause").then(setPlayback, () => {}) // a lost session shows above
  const items = [...queue.values()].sort((a, b) => b.frame - a.frame || b.moment_id.localeCompare(a.moment_id))
  const briefed = items.filter((i) => i.status === "approved" || i.status === "on_air")
  return (
    <main className="mx-auto grid max-w-7xl gap-4 p-6 font-sans lg:grid-cols-3">
      <header className="flex items-center gap-3 lg:col-span-3">
        <h1 className="text-2xl font-bold">{t(lang, "studio")}</h1>
        <span className="rounded bg-slate-800 px-2 py-0.5 text-sm">{`${segment.mode}.${segment.lang}.${segment.club ?? "neutral"}`}</span>
        {playback && <span className="text-sm text-slate-400">{playback.state} · ×{playback.speed}</span>}
        {playback?.state !== "ended" && (
          <button type="button" className="ml-auto rounded bg-emerald-600 px-3 py-1 text-white" onClick={togglePlayback}>
            {t(lang, playback?.state === "paused" ? "resumeSession" : "pauseSession")}
          </button>
        )}
      </header>
      {connection !== "ok" && <p role="status" className="rounded bg-amber-900/60 px-3 py-1 text-center text-sm lg:col-span-3">{t(lang, connection === "gone" ? "gone" : "lost")}</p>}
      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">{t(lang, "queue")}</h2>
        {items.length === 0 && <p className="text-slate-400">{t(lang, "emptyQueue")}</p>}
        <ol aria-label={t(lang, "queue")} className="flex flex-col gap-2">
          {items.map((i) => (
            <li key={i.moment_id} className="rounded-lg bg-slate-900 p-3 ring-1 ring-slate-800">
              <div className="flex items-center gap-2">
                <span className="tabular-nums text-slate-400">{i.clock}</span>
                <h3 lang={i.cue?.segment.lang} className="flex-1 truncate font-semibold">{i.cue?.text?.headline ?? i.moment_id}</h3>
                <span className={`rounded px-2 py-0.5 text-xs text-white ${STATUS[i.status].style}`}>{t(lang, STATUS[i.status].key)}</span>
              </div>
              <div className="mt-2 flex gap-2 text-sm">
                <button type="button" className="rounded bg-sky-800 px-2 py-0.5" onClick={() => decide(i, "approve")}>{t(lang, "approve")}</button>
                <button type="button" className="rounded bg-amber-800 px-2 py-0.5" onClick={() => decide(i, "hold")}>{t(lang, "hold")}</button>
                <button type="button" className="rounded bg-red-700 px-2 py-0.5" onClick={() => decide(i, "send")}>{t(lang, "send")}</button>
              </div>
            </li>
          ))}
        </ol>
      </section>
      <section aria-label={t(lang, "talkingPoints")} className="flex flex-col gap-2">
        <h2 className="font-semibold">{t(lang, "talkingPoints")}</h2>
        {briefed.length === 0 && <p className="text-slate-400">{t(lang, "noPoints")}</p>}
        {briefed.map((i) => (
          <article key={i.moment_id} className="rounded-lg bg-slate-900 p-3 ring-1 ring-sky-800">
            <h3 className="font-semibold"><span className="tabular-nums text-slate-400">{i.clock}</span> {i.cue?.text?.headline ?? i.moment_id}</h3>
            <ul className="mt-1 list-disc pl-5 text-sm">{i.points.map((p, n) => <li key={n}>{p}</li>)}</ul>
          </article>
        ))}
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">{t(lang, "rawFeed")}</h2>
        <ol aria-label={t(lang, "rawFeed")} className="flex max-h-[70vh] flex-col gap-1 overflow-y-auto font-mono text-xs">
          {feed.map((c) => (
            <li key={c.cue_id} lang={c.segment.lang} className="rounded bg-slate-900 px-2 py-1">
              {c.anchor.clock} · {`${c.segment.mode}.${c.segment.lang}.${c.segment.club ?? "neutral"}`} · {c.display.slot} · {c.verified ? "✓" : "✗"} · {c.text?.headline}
            </li>
          ))}
        </ol>
      </section>
    </main>
  )
}
