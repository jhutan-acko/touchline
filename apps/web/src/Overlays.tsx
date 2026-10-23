import type { Cue } from "@touchline/schema"
import { t, type Lang } from "./i18n.js"
import { inSlot, type PaneState } from "./pane.js"

const Verified = ({ lang }: { lang: Lang }) => <span className="ml-2 rounded bg-emerald-700/60 px-1.5 text-xs font-medium" title={t(lang, "verified")}>✓</span>

const numbers = (cue: Cue) => Object.entries(cue.data).filter(([k]) => !k.startsWith("score."))

/** The cues on screen for this pane at a match frame (the latest, or the frozen one), over the pitch (spec §5.4 slots). */
export const Overlays = ({ state, frame, lang, onWhy }: { state: PaneState; frame: number; lang: Lang; onWhy?: (cue: Cue) => void }) => {
  const lower = inSlot(state, "lower_third", frame)[0]
  const side = inSlot(state, "side_panel", frame)[0]
  const recap = inSlot(state, "recap_card", frame)[0]
  const why = (cue: Cue) =>
    onWhy && (
      <button type="button" className="ml-auto rounded bg-slate-700 px-2 py-0.5 text-xs hover:bg-slate-600" onClick={() => onWhy(cue)}>
        {t(lang, "why")}
      </button>
    )
  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col justify-end p-3">
      {recap?.text && (
        <article data-slot="recap_card" lang={recap.segment.lang} className="pointer-events-auto mx-auto mb-auto mt-6 max-w-md rounded-xl bg-slate-900/95 p-4 ring-1 ring-amber-400/60">
          <h3 className="flex items-center font-bold text-amber-300">{recap.text.headline}<Verified lang={lang} />{why(recap)}</h3>
          <p className="mt-1 text-sm">{recap.text.body}</p>
        </article>
      )}
      {side?.text && (
        <aside data-slot="side_panel" lang={side.segment.lang} className="pointer-events-auto absolute right-3 top-3 w-72 rounded-xl bg-slate-900/95 p-3 ring-1 ring-sky-400/50">
          <h3 className="flex items-center font-semibold">{side.text.headline}<Verified lang={lang} />{why(side)}</h3>
          <p className="mt-1 text-sm text-slate-200">{side.text.body}</p>
          {numbers(side).length > 0 && (
            <dl className="mt-2 grid grid-cols-2 gap-1 text-xs">
              {numbers(side).map(([k, v]) => (
                <div key={k} className="contents"><dt className="text-slate-400">{k}</dt><dd className="text-right tabular-nums">{Math.round(v * 1000) / 1000}</dd></div>
              ))}
            </dl>
          )}
          <p className="mt-2 text-xs text-slate-400">{side.evidence.length} · {t(lang, "events")}</p>
        </aside>
      )}
      {lower?.text && (
        <article data-slot="lower_third" lang={lower.segment.lang} className={`pointer-events-auto rounded-xl p-3 ring-1 ${lower.display.priority === 1 ? "bg-emerald-800/95 ring-emerald-300" : "bg-slate-900/95 ring-slate-600"}`}>
          <h3 className="flex items-center text-lg font-bold">{lower.text.headline}<Verified lang={lang} />{why(lower)}</h3>
          <p className="text-sm">{lower.text.body}</p>
        </article>
      )}
    </div>
  )
}
