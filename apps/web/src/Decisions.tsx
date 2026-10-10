import type { MatchInfo } from "@touchline/rpc"
import { decisionKey } from "@touchline/rpc"
import type { Decision } from "@touchline/schema"
import { t, type Key, type Lang } from "./i18n.js"

const REASONS: Readonly<Record<Decision["reasons"][number], Key>> = { half_time: "rHalfTime", after_goal: "rAfterGoal", minute_60: "rMinute60", minute_75: "rMinute75" }
const SOURCES: Readonly<Record<Decision["options"][number]["source"], Key>> = { agent: "srcAgent", rules: "srcRules", no_change: "srcNoChange" }

const teamOf = (match: MatchInfo, d: Decision) => (match.home.id === d.team_id ? match.home : match.away)
const signed = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}`

/**
 * A decision's minute as a fan reads it: added time as "45+3'" or "90+2'". The first half ends at the half-time
 * decision's tick (every managed match has one; without it, only the 90+ form is used).
 */
export const minuteLabel = (d: Decision, all: ReadonlyArray<Decision>): string => {
  const m = Math.floor(d.minute)
  const halfTime = all.find((x) => x.reasons.includes("half_time"))?.tick
  if (halfTime !== undefined && d.tick < halfTime && m >= 45) return `45+${m - 44}'`
  if ((halfTime === undefined || d.tick >= halfTime) && m >= 90) return `90+${m - 89}'`
  return `${m}'`
}

/** Markers closer than this (% of the strip) would overlap. */
const MARKER_GAP_PCT = 4

/** One marker per moment the session has reached (every team that decided then), along the match; a marker opens its cards. */
export const DecisionStrip = ({ match, decisions, open, onOpen, lang }: { match: MatchInfo; decisions: ReadonlyArray<Decision>; open: number | null; onOpen: (tick: number) => void; lang: Lang }) => {
  const ticks = [...new Set(decisions.map((d) => d.tick))].sort((a, b) => a - b)
  const left = (tick: number) => Math.min(98, Math.max(2, (100 * tick) / Math.max(1, match.frames)))
  // A marker too close to the one before it (the end of a half and the next kickoff) drops to a second row.
  const rows: number[] = []
  ticks.forEach((tick, i) => rows.push(i > 0 && left(tick) - left(ticks[i - 1]!) < MARKER_GAP_PCT ? 1 - rows[i - 1]! : 0))
  return (
    <nav aria-label={t(lang, "decisions")} className="relative rounded bg-slate-900" style={{ height: rows.includes(1) ? 52 : 28 }}>
      {ticks.map((tick, i) => {
        const ds = decisions.filter((d) => d.tick === tick)
        const teams = ds.map((d) => teamOf(match, d))
        return (
          <button
            key={tick}
            type="button"
            aria-pressed={open === tick}
            aria-label={`${minuteLabel(ds[0]!, decisions)} ${teams.map((x) => x.short).join("·")}`}
            title={`${teams.map((x) => x.name).join(" · ")} · ${minuteLabel(ds[0]!, decisions)}`}
            className="absolute h-5 -translate-x-1/2 rounded px-1 text-xs text-white"
            style={{ left: `${left(tick)}%`, top: rows[i] ? 28 : 4, background: teams.length > 1 ? "#475569" : teams[0]!.kit.primary }}
            onClick={() => onOpen(tick)}
          >
            {minuteLabel(ds[0]!, decisions)}
          </button>
        )
      })}
    </nav>
  )
}

/** A decision: why it was taken, every option with its re-simulated gain over no change, the pick and the reason. */
export const DecisionCard = ({ match, decision: d, all, onClose, lang }: { match: MatchInfo; decision: Decision; all: ReadonlyArray<Decision>; onClose: () => void; lang: Lang }) => {
  const scale = Math.max(0.05, ...d.options.map((o) => (o.xg_diff_vs_no_change ? Math.abs(o.xg_diff_vs_no_change.mean) + o.xg_diff_vs_no_change.se : 0)))
  return (
    <section role="dialog" aria-label={`${teamOf(match, d).name} · ${minuteLabel(d, all)}`} className="flex flex-col gap-2 rounded border border-slate-700 bg-slate-900 p-3 text-sm">
      <header className="flex items-center gap-2">
        <h3 className="font-semibold">{teamOf(match, d).name} · {minuteLabel(d, all)}</h3>
        <span className="text-slate-400">{d.reasons.map((r) => t(lang, REASONS[r])).join(" · ")}</span>
        <button type="button" className="ml-auto rounded bg-slate-800 px-2" onClick={onClose}>{t(lang, "close")}</button>
      </header>
      <p className="text-xs text-slate-400">{t(lang, "xgVsNoChange")}</p>
      <ol className="flex flex-col gap-1">
        {d.options.map((o) => {
          const e = o.xg_diff_vs_no_change
          const picked = o.index === d.pick
          return (
            <li key={o.index} aria-current={picked ? "true" : undefined} className={`grid grid-cols-[1fr_8rem_6rem] items-center gap-2 rounded px-2 py-1 ${picked ? "bg-emerald-900/60" : ""}`}>
              <span>
                {o.label} <span className="text-xs text-slate-400">({t(lang, SOURCES[o.source])})</span>
                {picked && <strong className="ml-2 text-emerald-300">{t(lang, "picked")}</strong>}
              </span>
              <span className="relative h-2 rounded bg-slate-800">
                {e && <span className={`absolute top-0 h-2 rounded ${e.mean >= 0 ? "left-1/2 bg-emerald-500" : "right-1/2 bg-rose-500"}`} style={{ width: `${(50 * Math.abs(e.mean)) / scale}%` }} />}
              </span>
              <span className="tabular-nums text-right">{o.untested ? t(lang, "untested") : e ? `${signed(e.mean)} ± ${e.se.toFixed(2)}` : "–"}</span>
            </li>
          )
        })}
      </ol>
      <p lang="en">{d.reason}</p>
      {d.fallback && <p className="text-xs text-amber-300">{t(lang, "fallbackNote")}</p>}
      <p className="text-xs text-slate-500">{d.model}</p>
    </section>
  )
}
