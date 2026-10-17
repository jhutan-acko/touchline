import type { Params } from "./params.js"
import type { Vec2 } from "./geometry.js"
import type { PlayerState } from "./types.js"

/** Where a tackler stands relative to the carrier's run (T2). */
export type Bearing = "front" | "side" | "behind"

/**
 * The tackler's bearing from the carrier, relative to the carrier's velocity. Below `headingMinMps` the carrier's attack
 * direction (+-1 along x) stands in for his heading. Under `frontDeg` is front, from `behindDeg` is behind, else side.
 */
export const bearingOf = (carrier: Vec2, carrierVel: Vec2, attackDir: number, def: Vec2, t: Params["tackle"]): Bearing => {
  const speed = Math.hypot(carrierVel.x, carrierVel.y)
  const hx = speed < t.headingMinMps ? attackDir : carrierVel.x / speed
  const hy = speed < t.headingMinMps ? 0 : carrierVel.y / speed
  const dx = def.x - carrier.x, dy = def.y - carrier.y
  const d = Math.hypot(dx, dy)
  if (d === 0) return "side"
  const cos = Math.max(-1, Math.min(1, (hx * dx + hy * dy) / d))
  const deg = (Math.acos(cos) * 180) / Math.PI
  return deg < t.frontDeg ? "front" : deg >= t.behindDeg ? "behind" : "side"
}

/** Outfield defenders other than the tackler, not sent off, within `radiusM` of the carrier. */
export const supportCount = (carrier: Vec2, tacklerId: string, opponents: ReadonlyArray<PlayerState>, radiusM: number): number => {
  let n = 0
  for (const o of opponents) {
    if (o.id === tacklerId || o.role === "GK" || o.sentOff) continue
    if (Math.hypot(o.pos.x - carrier.x, o.pos.y - carrier.y) <= radiusM) n++
  }
  return n
}

/** T2: base + 3 skillDiff + approach + supportLogit min(n, supportMax) + speedLogit carrierSpeed + (inBox ? boxLogit : 0). */
export const tackleLogit = (base: number, skillDiff: number, bearing: Bearing, support: number, carrierSpeed: number, inBox: boolean, t: Params["tackle"]): number =>
  base + 3 * skillDiff + (bearing === "front" ? t.frontLogit : bearing === "behind" ? t.behindLogit : 0) +
  t.supportLogit * Math.min(support, t.supportMax) + t.speedLogit * carrierSpeed + (inBox ? t.boxLogit : 0)
