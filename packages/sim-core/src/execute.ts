import { launchVelocity } from "./ball.js"
import { dist, type Vec2, type Vec3 } from "./geometry.js"
import type { PassHeight } from "./classify.js"
import type { Params } from "./params.js"
import type { Rng } from "./rng.js"

export type Execution = "clean" | "inaccurate" | "overhit" | "underhit" | "mishit"

export interface KickIntent {
  readonly from: Vec2
  readonly to: Vec2
  readonly height: PassHeight
  /** 0..1 skill for this kind of kick (shortPassing, longPassing, crossing...). */
  readonly technique: number
  readonly composure: number
  /** 0..1 from nearest-opponent distance. */
  readonly pressure: number
  readonly weakFoot: boolean
  /** 0 fresh .. 1 exhausted (1 - energy); widens the error by execution.executionK. */
  readonly fatigue?: number
  /** Multiplies the mis-hit chance (scenario scripts); `forceMishit` makes this kick a mis-hit. */
  readonly mishitScale?: number
  readonly forceMishit?: boolean
  /** Multiplies the direction and distance error (keeper throws below 1, punts above; P3 G5). Undefined means 1. */
  readonly errorScale?: number
}

export interface Executed {
  readonly to: Vec2
  readonly vel: Vec3
  readonly execution: Execution
  readonly errorM: number
}

/** Pressure 1 when an opponent is within 1 m, 0 beyond 5 m. */
export const pressureFrom = (nearestOpponentM: number): number => Math.max(0, Math.min(1, 1 - (nearestOpponentM - 1) / 4))

/**
 * How much tiredness widens a kick's error (P6 SH4, plan 8f Task 6 owns this body). `fatigue` is 0 fresh .. 1 exhausted.
 * rule 0: the old behaviour, 1 + fatigue.executionK x fatigue.
 * rule 1: flat until `ref`, then rising: 1 + k x max(0, fatigue - ref)^power (execFatigue).
 */
export const fatigueScale = (fatigue: number, p: Params): number => {
  const x = p.execFatigue
  return x.rule === 1 ? 1 + x.k * Math.pow(Math.max(0, fatigue - x.ref), x.power) : 1 + p.fatigue.executionK * fatigue
}

/**
 * Turn an intended kick into the actual one: Gaussian direction and distance error that grows
 * with pressure, weak foot and low technique, plus a heavy-tail "mis-hit" mixture.
 */
export const executeKick = (k: KickIntent, p: Params, rng: Rng): Executed => {
  const e = p.execution
  const dx = k.to.x - k.from.x
  const dy = k.to.y - k.from.y
  const intendedLen = Math.max(0.5, Math.hypot(dx, dy))
  const ang0 = Math.atan2(dy, dx)
  const skill = (1.35 - 0.7 * k.technique) * fatigueScale(k.fatigue ?? 0, p) * (k.errorScale ?? 1)
  const foot = k.weakFoot ? e.weakFootK : 1
  const pressureScale = 1 + e.pressureK * k.pressure
  const pMishit = Math.min(0.35, e.mishitBase + e.mishitK * Math.pow(k.pressure, 1.6) * (1.2 - k.composure) * (k.weakFoot ? 1.6 : 1))
  const g1 = rng.normal()
  const g2 = rng.normal()
  const mishit = rng.chance(Math.min(1, pMishit * (k.mishitScale ?? 1))) || k.forceMishit === true
  const g3 = rng.normal()
  const u = rng.uniform()
  let ang: number
  let actualLen: number
  if (mishit) {
    ang = ang0 + g3 * 0.45
    actualLen = intendedLen * (0.35 + 1.3 * u)
  } else {
    // X2: a high ball beyond pass.longErrorFromM misses by more per metre (pass.longErrorPerM; 0 = off, exactly).
    // Multiplies the same expression as errorScale (inside skill), so the two compose multiplicatively.
    const longScale = k.height === "high" ? 1 + p.pass.longErrorPerM * Math.max(0, intendedLen - p.pass.longErrorFromM) : 1
    ang = ang0 + g1 * e.dirSigma * pressureScale * skill * foot * longScale
    actualLen = intendedLen * (1 + g2 * e.distSigma * pressureScale * skill * foot * longScale)
  }
  const to = { x: k.from.x + Math.cos(ang) * actualLen, y: k.from.y + Math.sin(ang) * actualLen }
  const errorM = dist(to, k.to)
  let execution: Execution
  if (mishit) execution = "mishit"
  else if (errorM < 2) execution = "clean"
  else if (Math.abs(actualLen - intendedLen) > 0.6 * errorM) execution = actualLen > intendedLen ? "overhit" : "underhit"
  else execution = "inaccurate"
  return { to, vel: launchVelocity(k.from, to, k.height, p), execution, errorM }
}
