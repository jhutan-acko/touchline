import { useEffect, useState } from "react"
import type { Evidence } from "@touchline/rpc"
import type { Cue } from "@touchline/schema"
import type { TouchlineClient } from "./client.js"
import { t, type Lang } from "./i18n.js"
import { Sparkline } from "./Sparkline.js"

/** Behind a cue (spec §5.6 "Why?" drawer): the cause, each checked fact, the metric's history and the events. */
export const WhyDrawer = ({ client, sessionId, cue, lang, onClose, onShowMe }: {
  client: TouchlineClient
  sessionId: string
  cue: Cue
  lang: Lang
  onClose: () => void
  /** Open the what-if split on a pass (offered when re-simulation found, or may find, a better option). */
  onShowMe?: (eventId: string) => void
}) => {
  const [ev, setEv] = useState<Evidence | null | "none">(null)
  useEffect(() => {
    let live = true
    client.evidence(sessionId, cue.cue_id).then((e) => live && setEv(e), () => live && setEv("none"))
    return () => {
      live = false
    }
  }, [client, sessionId, cue.cue_id])
  return (
    <aside role="dialog" aria-label={t(lang, "why")} className="fixed inset-y-0 right-0 z-10 w-full max-w-md overflow-y-auto bg-slate-900 p-5 shadow-2xl ring-1 ring-slate-700">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-bold">{t(lang, "why")}</h2>
        <button type="button" className="rounded bg-slate-800 px-3 py-1" onClick={onClose}>{t(lang, "close")}</button>
      </div>
      {cue.text && (
        <div lang={cue.segment.lang} className="mb-4 rounded-lg bg-slate-800 p-3">
          <p className="font-semibold">{cue.text.headline}</p>
          <p className="text-sm text-slate-300">{cue.text.body}</p>
        </div>
      )}
      {ev === null && <p>{t(lang, "loading")}</p>}
      {ev === "none" && <p className="text-slate-400">—</p>}
      {ev !== null && ev !== "none" && (
        <div className="flex flex-col gap-4 text-sm">
          {ev.cause && (
            <section>
              <h3 className="font-semibold text-slate-400">{t(lang, "cause")}</h3>
              <p className="font-medium">{ev.cause}</p>
              {ev.explanation && <p className="text-slate-300">{ev.explanation}</p>}
            </section>
          )}
          {ev.what_if && onShowMe && (ev.what_if.verdict === null || ev.what_if.verdict === "better_option_found") && (
            <button type="button" className="self-start rounded bg-amber-400 px-3 py-1 font-semibold text-slate-950" onClick={() => onShowMe(ev.what_if!.event_id)}>{t(lang, "showMe")}</button>
          )}
          {ev.what_if?.verdict === "played_pass_was_best" && <p className="text-slate-300">{t(lang, "bestPlayed")}</p>}
          {ev.what_if?.verdict === "not_verified" && <p className="text-slate-300">{t(lang, "notVerified")}</p>}
          <section>
            <h3 className="font-semibold text-slate-400">{t(lang, "claims")}</h3>
            <ul className="mt-1 flex flex-col gap-1">
              {ev.claims.map((c, i) => (
                <li key={i} className="flex justify-between gap-2 rounded bg-slate-800 px-2 py-1">
                  <span>{c.label}{c.subject_name ? ` — ${c.subject_name}` : ""}</span>
                  <span className="tabular-nums">{c.quote || (c.value !== null ? String(Math.round(c.value * 1000) / 1000) : c.event_id ?? "")} ✓</span>
                </li>
              ))}
            </ul>
          </section>
          {ev.series.length > 0 && (
            <section>
              <h3 className="font-semibold text-slate-400">{t(lang, "history")}</h3>
              <div className="mt-1 flex flex-col gap-2">{ev.series.map((s) => <Sparkline key={`${s.metric_id}-${s.subject}`} series={s} />)}</div>
            </section>
          )}
          {ev.events.length > 0 && (
            <section>
              <h3 className="font-semibold text-slate-400">{t(lang, "events")}</h3>
              <ul className="mt-1 flex flex-col gap-1">
                {ev.events.map((e) => (
                  <li key={e.id} className="rounded bg-slate-800 px-2 py-1">
                    <span className="tabular-nums text-slate-400">{e.clock.slice(0, 5)}</span> {e.type} · {e.player ?? "—"}{e.outcome ? ` · ${e.outcome}` : ""}
                    {Object.entries(e.qualifiers).map(([k, v]) => <span key={k} className="ml-1 rounded bg-slate-700 px-1 text-xs">{k}: {String(v)}</span>)}
                  </li>
                ))}
              </ul>
            </section>
          )}
          <p className="text-xs text-slate-500">{t(lang, "verified")}{ev.model ? ` · ${t(lang, "model")} ${ev.model}` : ""}</p>
        </div>
      )}
    </aside>
  )
}
