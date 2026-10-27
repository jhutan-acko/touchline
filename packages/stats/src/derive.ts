import { dirOf } from "@touchline/sim-core"
import type { DomainEvent } from "@touchline/schema"
import type { TrackFrame } from "./input.js"
import { directFreeKickXg, keeperIndex, passFeatures, predict, predictXg, shotFeatures, type StatsModels } from "./models.js"

/** Opponents of `side` in a frame (none without a frame). */
const opponents = (f: TrackFrame | undefined, side: "home" | "away") => (f ? (side === "home" ? f.away : f.home) : [])

export interface PassValues {
  readonly "pass.dist": number
  /** Null without a tracking frame at the pass (the defenders in lane and the pressure are unknown). */
  readonly "pass.xp": number | null
}

/** Length and modelled completion probability of a pass, from its locations and the frame at its release. */
export const passValues = (e: DomainEvent, f: TrackFrame | undefined, side: "home" | "away", models: StatsModels): PassValues | null => {
  if (e.x === null || e.y === null || e.x_end === null || e.y_end === null) return null
  const start = { x: e.x, y: e.y }
  const end = { x: e.x_end, y: e.y_end }
  return {
    "pass.dist": Math.hypot(end.x - start.x, end.y - start.y),
    "pass.xp": f ? predict(models.xpass, passFeatures(start, end, dirOf(side, e.period), opponents(f, side))) : null
  }
}

/**
 * The opponents' outfield players in a frame: `keepers` (the known goalkeeper ids) left out, or, when no roles are known
 * (an empty set), the one nearest the goal they defend.
 */
const outfieldOpponents = (f: TrackFrame | undefined, side: "home" | "away", attack: 1 | -1, keepers: ReadonlySet<string>) => {
  const opp = opponents(f, side)
  if (keepers.size > 0) return opp.filter((o) => !keepers.has(o.id))
  const k = keeperIndex(attack, opp)
  return opp.filter((_, i) => i !== k)
}

/**
 * Expected goals of a shot: the simulator's own xG (P6 pre-merge fix 3), so it equals the shot's recorded attrs.xg up to
 * rounding. Penalties at the fixed rate; a central direct free kick by sim-core directFkXg; otherwise sim-core xgFrom on
 * the distance, goal-mouth angle, header and outfield defenders in the shot line in `f`, which should be the frame the
 * shooter decided on (StatsEngine passes the frame before the shot's tick for a shot after control, the shot's own
 * frame for a first-time shot or header, which is struck at contact after the players' moves).
 */
export const shotXg = (e: DomainEvent, f: TrackFrame | undefined, side: "home" | "away", models: StatsModels, keepers: ReadonlySet<string> = new Set()): number | null => {
  if (e.attrs.technique === "penalty") return models.xg.penalty
  if (e.x === null || e.y === null) return null
  const at = { x: e.x, y: e.y }
  if (e.attrs.technique === "free_kick") {
    const fk = directFreeKickXg(models.xg, at, side, e.period)
    if (fk !== null) return fk
  }
  const attack = dirOf(side, e.period)
  return predictXg(models.xg, shotFeatures(at, attack, e.attrs.body_part === "head", outfieldOpponents(f, side, attack, keepers)))
}
