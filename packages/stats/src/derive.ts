import { dirOf } from "@touchline/sim-core"
import type { DomainEvent } from "@touchline/schema"
import type { TrackFrame } from "./input.js"
import { passFeatures, predict, shotFeatures, type StatsModels } from "./models.js"

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

/** Expected goals of a shot (penalties at the fixed rate), from its location and the frame at the strike. */
export const shotXg = (e: DomainEvent, f: TrackFrame | undefined, side: "home" | "away", models: StatsModels): number | null => {
  if (e.attrs.technique === "penalty") return models.xg.penalty
  if (e.x === null || e.y === null) return null
  return predict(models.xg, shotFeatures({ x: e.x, y: e.y }, dirOf(side, e.period), e.attrs.body_part === "head", opponents(f, side)))
}
