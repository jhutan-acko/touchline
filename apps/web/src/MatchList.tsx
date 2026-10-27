import { useState } from "react"
import type { MatchSummary } from "@touchline/rpc"
import { withTeamColours } from "./colours.js"
import { t, type Key, type Lang } from "./i18n.js"

const SCENARIO_KEY: Record<string, Key> = {
  even_contest: "scEvenContest",
  late_comeback: "scLateComeback",
  red_card_collapse: "scRedCard",
  keeper_heroics: "scKeeperHeroics",
  costly_error: "scCostlyError",
  high_press_vs_low_block: "scHighPress"
}

/** A match's scenario as a friendly title ("late_comeback" → "Late comeback"), in the viewer's language when known. */
export const scenarioTitle = (scenario: string | null, lang: Lang): string | null => {
  if (!scenario) return null
  const key = SCENARIO_KEY[scenario]
  if (key) return t(lang, key)
  const words = scenario.replace(/[_-]+/g, " ").trim()
  return words ? words[0]!.toUpperCase() + words.slice(1) : null
}

const Team = ({ name, colour, end = false }: { name: string; colour: string; end?: boolean }) => (
  <span className={`flex min-w-0 items-center gap-2 ${end ? "flex-row-reverse text-right" : ""}`}>
    <span aria-hidden className="inline-block h-3.5 w-3.5 shrink-0 rounded-full ring-1 ring-white/30" style={{ background: colour }} />
    <span className="truncate">{name}</span>
  </span>
)

/**
 * The library: one card per match, titled by its scenario, with its teams in their on-screen colours. No spoilers:
 * final scores stay hidden until the viewer asks for them.
 */
export const MatchList = ({ matches, lang, onWatch }: { matches: ReadonlyArray<MatchSummary>; lang: Lang; onWatch: (m: MatchSummary) => void }) => {
  const [results, setResults] = useState(false)
  if (!matches.length) return <p className="text-slate-400">{t(lang, "noMatches")}</p>
  return (
    <div className="flex flex-col gap-3">
      <label className="self-end text-xs text-slate-400">
        <input type="checkbox" className="mr-1 align-middle" checked={results} onChange={(e) => setResults(e.target.checked)} />
        {t(lang, "showResults")}
      </label>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {matches.map((raw) => {
          const m = withTeamColours(raw)
          const title = scenarioTitle(m.scenario, lang)
          return (
            <li key={m.match_id} className="flex flex-col gap-3 rounded-xl bg-slate-900 p-4 ring-1 ring-slate-800">
              {title && <h3 className="text-xs font-semibold uppercase tracking-wide text-amber-300">{title}</h3>}
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-base font-semibold">
                <Team name={m.home.name} colour={m.home.kit.primary} />
                <span className="shrink-0 whitespace-nowrap text-sm tabular-nums text-slate-400" data-testid="result">
                  {results ? <span className="text-lg text-slate-100">{m.score.home}–{m.score.away}</span> : t(lang, "versus")}
                </span>
                <Team name={m.away.name} colour={m.away.kit.primary} end />
              </div>
              <div className="flex items-center justify-between gap-2 text-sm text-slate-400">
                <span className="truncate">{m.managers ? `${t(lang, "managed")}: ${m.managers.home ?? "—"} v ${m.managers.away ?? "—"}` : (m.model ?? t(lang, "stats"))} · #{m.seed}</span>
                <button type="button" className="shrink-0 rounded-lg bg-emerald-600 px-3 py-1 font-medium text-white hover:bg-emerald-500" onClick={() => onWatch(raw)}>{t(lang, "watch")}</button>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
