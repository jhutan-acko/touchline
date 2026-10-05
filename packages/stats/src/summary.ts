import type { MetricId } from "@touchline/schema"
import { metricDef } from "./catalog.js"
import type { StatsEngine } from "./engine.js"

const TEAM_METRICS: ReadonlyArray<MetricId> = ["team.poss", "pass.acc", "pass.xp", "pass.dist", "shot.xg", "shot.speed", "team.press", "ppda", "tilt", "team.mom", "plyr.dist"]

const fmt = (v: number | null, unit: string) => (v === null ? "-" : unit === "share" ? `${(v * 100).toFixed(1)} %` : unit === "m" && v > 1000 ? `${(v / 1000).toFixed(1)} km` : v.toFixed(2))

/** A plain-text match summary: score, team metrics over the whole match, signal counts and the most salient signals. */
export const summary = (eng: StatsEngine, top = 12): string => {
  const { home, away } = eng.info
  const name = (id: string | null) => (id === null ? "" : ([...home.players, ...away.players].find((p) => p.id === id)?.name ?? eng.team(id)?.name ?? id))
  const lines = [`${home.name} ${eng.score.home}-${eng.score.away} ${away.name}`, ""]
  lines.push(`${"metric".padEnd(36)}${home.name.padStart(22)}${away.name.padStart(22)}`)
  for (const id of TEAM_METRICS) {
    const def = metricDef(id)!
    const v = (t: string) => fmt(eng.value(id, t, { windowS: null }), def.unit)
    lines.push(`${`${def.name} (${id})`.padEnd(36)}${v(home.id).padStart(22)}${v(away.id).padStart(22)}`)
  }
  const counts = new Map<string, number>()
  for (const s of eng.signals) counts.set(s.type, (counts.get(s.type) ?? 0) + 1)
  lines.push("", `Signals: ${eng.signals.length} (${[...counts].map(([k, n]) => `${k} ${n}`).join(", ")})`)
  const best = [...eng.signals].sort((a, b) => b.salience - a.salience || a.frame_id - b.frame_id).slice(0, top).sort((a, b) => a.frame_id - b.frame_id)
  for (const s of best)
    lines.push(`  ${s.match_clock}  ${s.type.padEnd(25)} ${(name(s.player_id) || name(s.team_id)).padEnd(24)} ${s.metric ?? ""}${s.value === null ? "" : ` = ${s.value}`}`)
  return lines.join("\n")
}
