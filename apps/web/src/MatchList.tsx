import type { MatchSummary } from "@touchline/rpc"
import { t, type Lang } from "./i18n.js"

/** The library: one card per match, with its teams in their kit colours and whether it has agent cues. */
export const MatchList = ({ matches, lang, onWatch }: { matches: ReadonlyArray<MatchSummary>; lang: Lang; onWatch: (m: MatchSummary) => void }) => {
  if (!matches.length) return <p className="text-slate-400">{t(lang, "noMatches")}</p>
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {matches.map((m) => (
        <li key={m.match_id} className="rounded-xl bg-slate-900 p-4 ring-1 ring-slate-800">
          <div className="flex items-center justify-between gap-2 text-lg font-semibold">
            <span className="flex items-center gap-2"><span className="inline-block h-3 w-3 rounded-full" style={{ background: m.home.kit.primary }} />{m.home.name}</span>
            <span className="shrink-0 whitespace-nowrap tabular-nums">{m.score.home}–{m.score.away}</span>
            <span className="flex items-center gap-2">{m.away.name}<span className="inline-block h-3 w-3 rounded-full" style={{ background: m.away.kit.primary }} /></span>
          </div>
          <div className="mt-2 flex items-center justify-between text-sm text-slate-400">
            <span>{m.scenario ?? "—"} · {m.model ?? t(lang, "stats")}</span>
            <button type="button" className="rounded-lg bg-emerald-600 px-3 py-1 font-medium text-white hover:bg-emerald-500" onClick={() => onWatch(m)}>{t(lang, "watch")}</button>
          </div>
        </li>
      ))}
    </ul>
  )
}
