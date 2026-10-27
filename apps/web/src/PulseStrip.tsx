import { useMemo } from "react"
import type { MatchSummary } from "@touchline/rpc"
import type { Cue } from "@touchline/schema"
import { t, type Key, type Lang } from "./i18n.js"
import type { PaneState } from "./pane.js"
import { actionFor, axisMax, classify, minuteAt, momentumSeries, moments, view, type Moment, type MomentKind, type Point, type Rhythm } from "./pulse.js"

const W = 1000
const H = 100
const MID = H / 2

const KIND_KEY: Record<MomentKind, Key> = { goal: "pulseGoal", chance: "pulseChance", swing: "pulseSwing", pressure: "pulsePressure", decision: "pulseDecision", pass: "pulsePass", moment: "pulseMoment" }
const KIND_MARK: Record<MomentKind, string> = { goal: "⚽", chance: "◆", swing: "↕", pressure: "▲", decision: "✎", pass: "→", moment: "●" }
const RHYTHM_KEY: Record<Rhythm, Key> = { control: "pulseControl", mixed: "pulseMixed", chaos: "pulseChaos" }
const RHYTHM_COLOR: Record<Rhythm, string> = { control: "#34d399", mixed: "#94a3b8", chaos: "#f97316" }

/** The two filled areas of the momentum line: home above the midline, away below, each as tall as its lead. */
export const areas = (points: ReadonlyArray<Point>, max: number): { home: string; away: string } => {
  if (points.length < 2) return { home: "", away: "" }
  const x = (min: number) => Math.round((min / max) * W * 10) / 10
  const area = (sign: 1 | -1) => {
    const top = points.map((p) => `${x(p.min)},${Math.round((MID - sign * Math.max(0, sign * p.net) * MID) * 10) / 10}`)
    return `M${x(points[0]!.min)},${MID} L${top.join(" L")} L${x(points[points.length - 1]!.min)},${MID} Z`
  }
  return { home: area(1), away: area(-1) }
}

const pct = (v: number) => `${Math.round(v * 1000) / 10}%`
const round1 = (v: number) => Math.round(v * 10) / 10

/**
 * The match pulse: a strip across match time (0 to 90 and beyond) under the picture. The momentum line has the home side
 * above the midline and the away side below; the control-versus-chaos band shades each minute by how often the ball changed
 * hands; key moments are chapter markers. It shows only what the viewer has seen: up to the frozen frame, or the latest.
 * Clicking a moment still in the ring buffer freezes there and opens Ask; an older one opens its Why drawer.
 */
export const PulseStrip = ({ state, match, mode, lang, frozen = null, onFreeze, onWhy }: {
  state: PaneState
  match: Pick<MatchSummary, "home" | "away" | "fps">
  mode: "casual" | "analyst"
  lang: Lang
  frozen?: number | null
  onFreeze?: (frame: number) => void
  onWhy?: (cue: Cue) => void
}) => {
  const analyst = mode === "analyst"
  const upTo = frozen ?? state.head ?? 0
  // Live, everything the log holds has been seen; frozen, cut it at the frozen frame (no spoilers).
  const log = useMemo(() => (frozen === null ? state.pulse : view(state.pulse, upTo)), [state.pulse.samples, state.pulse.goals, state.pulse.changes, state.pulse.cues, frozen, upTo])
  const nowMin = frozen === null ? state.pulse.cursor?.min ?? 0 : minuteAt(state.pulse, frozen, match.fps)
  const max = axisMax(nowMin)
  const points = useMemo(() => momentumSeries(log.samples), [log.samples])
  const shape = useMemo(() => areas(points, max), [points, max])
  const bins = useMemo(() => (analyst ? classify(log.changes, state.pulse.firstMin, nowMin) : []), [analyst, log.changes, state.pulse.firstMin, nowMin])
  const marks = useMemo(() => moments(log, mode), [log, mode])
  const last = points[points.length - 1]
  const lead = last && Math.abs(last.net) >= 0.1 ? t(lang, "pulseOnTop").replace("{team}", (last.net > 0 ? match.home : match.away).name) : t(lang, "pulseEven")
  const x = (min: number) => pct(min / max)
  const name = (side: "home" | "away" | null) => (side ? match[side].name : "")
  const label = (m: Moment) => {
    const head = m.cue?.text?.headline ?? t(lang, KIND_KEY[m.kind])
    const clock = `${Math.floor(m.min)}'`
    const score = m.score ? ` ${m.score.home}–${m.score.away}` : ""
    const team = m.team ? ` ${name(m.team)}` : ""
    const action = actionFor(m, state.ring)
    const hint = action === "freeze" ? t(lang, "pulseFreeze") : action === "why" ? t(lang, "pulseWhy") : t(lang, "pulseOld")
    return analyst ? `${clock} · ${t(lang, KIND_KEY[m.kind])}${team}${score} · ${head} · ${hint}` : `${clock} · ${head}${score} · ${hint}`
  }
  const click = (m: Moment) => {
    const action = actionFor(m, state.ring)
    if (action === "freeze") onFreeze?.(m.frame)
    else if (action === "why" && m.cue) onWhy?.(m.cue)
  }
  const color = { home: match.home.kit.primary, away: match.away.kit.primary }
  return (
    <section aria-label={t(lang, "pulse")} data-testid="pulse" className="rounded-lg bg-slate-900 px-3 py-2 ring-1 ring-slate-800">
      <header className="mb-1 flex flex-wrap items-center justify-between gap-x-3 text-xs text-slate-300">
        <span className="font-semibold">{t(lang, "pulse")}</span>
        <span data-testid="pulse-lead">{lead}</span>
        <span className="tabular-nums text-slate-400">{match.home.short} ▲ · ▼ {match.away.short}</span>
      </header>
      <div className="relative h-20" title={analyst ? t(lang, "pulseHow") : t(lang, "pulseCasualHow")}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={t(lang, "momentum")} className="absolute inset-0 h-full w-full rounded bg-slate-950/60">
          <line x1={0} x2={W} y1={MID} y2={MID} stroke="#475569" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          {max > 45 && <line x1={(45 / max) * W} x2={(45 / max) * W} y1={0} y2={H} stroke="#334155" strokeDasharray="4 4" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
          {shape.home && <path d={shape.home} fill={color.home} fillOpacity={0.85} data-testid="pulse-home" />}
          {shape.away && <path d={shape.away} fill={color.away} fillOpacity={0.85} data-testid="pulse-away" />}
          <line x1={(nowMin / max) * W} x2={(nowMin / max) * W} y1={0} y2={H} stroke="#e2e8f0" strokeWidth={1.5} vectorEffect="non-scaling-stroke" data-testid="pulse-now" />
        </svg>
        {marks.map((m) => {
          const action = actionFor(m, state.ring)
          return (
            <button
              key={m.id}
              type="button"
              data-kind={m.kind}
              data-action={action}
              aria-label={label(m)}
              title={label(m)}
              aria-disabled={action === "none"}
              onClick={() => click(m)}
              style={{ left: x(m.min), top: m.team === "away" ? "70%" : m.team === "home" ? "10%" : "40%", ...(m.team ? { background: color[m.team] } : {}) }}
              className={`absolute -ml-2 flex h-5 w-5 items-center justify-center rounded-full bg-slate-200 text-[11px] leading-none text-slate-950 ring-1 ring-slate-950 ${action === "none" ? "cursor-default opacity-60" : "hover:ring-2 hover:ring-amber-300"}`}
            >
              <span aria-hidden>{KIND_MARK[m.kind]}</span>
            </button>
          )
        })}
      </div>
      {analyst && (
        <div className="relative mt-1 h-2 rounded bg-slate-950/60" data-testid="pulse-band" title={t(lang, "pulseHow")}>
          {bins.map((b) => (
            <span
              key={b.from}
              data-state={b.state ?? "none"}
              title={`${b.from}–${b.to}' · ${b.state ? t(lang, RHYTHM_KEY[b.state]) : t(lang, "pulseUnjudged")} · ${b.state ? `${round1(b.rate)} ${t(lang, "pulseTurnovers")}` : ""}`}
              className="absolute inset-y-0"
              style={{ left: x(b.from), width: pct(1 / max), background: b.state ? RHYTHM_COLOR[b.state] : "transparent" }}
            />
          ))}
        </div>
      )}
      <footer className="mt-1 flex flex-wrap items-center gap-x-3 text-[11px] text-slate-400">
        <span className="tabular-nums">0'</span>
        {analyst ? (
          <>
            {(["control", "mixed", "chaos"] as const).map((r) => (
              <span key={r} className="flex items-center gap-1" title={t(lang, "pulseHow")}>
                <span className="inline-block h-2 w-3 rounded-sm" style={{ background: RHYTHM_COLOR[r] }} />
                {t(lang, RHYTHM_KEY[r])}
              </span>
            ))}
            <span className="truncate" data-testid="pulse-how">{t(lang, "pulseHow")}</span>
          </>
        ) : (
          <span className="truncate">{t(lang, "pulseCasualHow")}</span>
        )}
        <span className="ml-auto tabular-nums">{max}'</span>
      </footer>
    </section>
  )
}
