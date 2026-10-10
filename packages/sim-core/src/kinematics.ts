import { add, len, norm, scale, sub, type Vec2 } from "./geometry.js"
import type { Params } from "./params.js"
import type { PlayerAttrs, Role } from "./types.js"

type Mover = { readonly attrs: PlayerAttrs; readonly role: Role }

export type Group = "GK" | "DEF" | "MID" | "FWD"
export const GROUP_OF: Readonly<Record<Role, Group>> = { GK: "GK", CB: "DEF", FB: "DEF", DM: "MID", CM: "MID", AM: "MID", W: "FWD", ST: "FWD" }

/** A player's movement limits: the acceleration-speed line A0 (1 - v / S0), the braking cap and the cap across the run. */
export interface Motion {
  readonly a0: number
  readonly s0: number
  readonly brake: number
  readonly lateral: number
}

/** Piecewise-linear through (knots[i], values[i]); flat beyond the ends. */
export const throughKnots = (x: number, knots: ReadonlyArray<number>, values: ReadonlyArray<number>): number => {
  if (x <= knots[0]!) return values[0]!
  for (let i = 1; i < knots.length; i++)
    if (x <= knots[i]!) return values[i - 1]! + ((x - knots[i - 1]!) / (knots[i]! - knots[i - 1]!)) * (values[i]! - values[i - 1]!)
  return values[values.length - 1]!
}

/** A player's limits: acceleration and pace attributes placed among the league's, onto the fitted spread for their position. */
export const motionFor = (pl: Mover, p: Params): Motion => {
  const m = p.physics.players
  const g = GROUP_OF[pl.role]
  return { a0: throughKnots(pl.attrs.acceleration, m.accelerationKnots, m.a0[g]), s0: throughKnots(pl.attrs.pace, m.paceKnots, m.s0[g]), brake: m.brake, lateral: m.lateral }
}

/** Top speed; tiredness takes off at most 3 % (top speed barely drops through a real match). */
export const vmaxFor = (pl: Mover, energy: number, p: Params): number => motionFor(pl, p).s0 * (0.97 + 0.03 * energy)

/**
 * One step of velocity towards `desired` within a player's limits: along the run, speeding up by at most
 * A0 (1 - v / S0) dt and slowing by at most brake dt; across it, at most max(lateral, A0 (1 - v / S0)) dt; the whole
 * change within a disc of max(A0, brake) dt. From a standstill every direction is forward.
 */
export const steer = (vel: Vec2, desired: Vec2, m: Motion, dt: number): Vec2 => {
  const dv = sub(desired, vel)
  const sp = len(vel)
  const fwd = Math.max(0, m.a0 * (1 - sp / m.s0))
  let change: Vec2
  if (sp < 1e-6) {
    const cap = m.a0 * dt
    change = len(dv) > cap ? scale(norm(dv), cap) : dv
  } else {
    const u = scale(vel, 1 / sp)
    const along = dv.x * u.x + dv.y * u.y
    const across = sub(dv, scale(u, along))
    const a = along > 0 ? Math.min(along, fwd * dt) : Math.max(along, -m.brake * dt)
    const latCap = Math.max(m.lateral, fwd) * dt
    const l = len(across)
    change = add(scale(u, a), l > latCap ? scale(across, latCap / l) : across)
  }
  const disc = Math.max(m.a0, m.brake) * dt
  const c = len(change)
  return add(vel, c > disc ? scale(change, disc / c) : change)
}

/**
 * Head for `target` and stop there: the desired speed is the fastest the braking cap can still stop from within the
 * distance left, counted in whole steps (v^2 / 2B + v dt / 2 = d), so the player does not overshoot.
 */
export const approach = (pos: Vec2, vel: Vec2, target: Vec2, vmax: number, m: Motion, dt: number): { pos: Vec2; vel: Vec2 } => {
  const to = sub(target, pos)
  const d = len(to)
  const half = (m.brake * dt) / 2
  const want = d < 0.05 ? 0 : Math.min(vmax, Math.sqrt(half * half + 2 * m.brake * d) - half)
  const nv = steer(vel, scale(norm(to), want), m, dt)
  return { pos: add(pos, scale(nv, dt)), vel: nv }
}

/** Meet a ball at a known time: aim for the velocity that arrives as `timeLeft` runs out, within the same limits. */
export const approachBy = (pos: Vec2, vel: Vec2, target: Vec2, vmax: number, m: Motion, dt: number, timeLeft: number): { pos: Vec2; vel: Vec2 } => {
  let desired = scale(sub(target, pos), 1 / Math.max(dt, timeLeft))
  if (len(desired) > vmax) desired = scale(norm(desired), vmax)
  const nv = steer(vel, desired, m, dt)
  return { pos: add(pos, scale(nv, dt)), vel: nv }
}

/** Energy after `dt` seconds at `speed` m/s for a player with the given stamina attribute (never below 0). */
export const drainEnergy = (energy: number, speed: number, stamina: number, dt: number, p: Params): number => {
  const f = p.fatigue
  return Math.max(0, energy - dt * (f.drainBase + f.drainSpeed2 * speed * speed) * (1 + f.staminaSlope * (0.5 - stamina)))
}

/**
 * Who can reach a moving ball (resolve.ts) is a tuned rule, not physics: after `kinematics.reactionS` a player covers
 * reachIn(t, 0, top speed, accelFor) towards the ball. The fitted 0.2 s reaction is the time to start moving; the rule's
 * longer delay also covers reading where the pass is going (spec docs/superpowers/specs/2026-10-09-physics-fit-design.md, Revision).
 */
export const accelFor = (a: PlayerAttrs, p: Params): number => p.kinematics.accelMax * (0.8 + 0.2 * a.acceleration)

/** Distance a player can cover in `t` seconds starting at speed `v0` (towards the target), accelerating at `amax` up to `vmax`. */
export const reachIn = (t: number, v0: number, vmax: number, amax: number): number => {
  if (t <= 0) return 0
  const v = Math.max(0, Math.min(v0, vmax))
  const ta = (vmax - v) / amax
  if (t <= ta) return v * t + 0.5 * amax * t * t
  return v * ta + 0.5 * amax * ta * ta + vmax * (t - ta)
}

/** Repulsion from teammates closer than radius, so players don't stack. */
export const separation = (pos: Vec2, others: ReadonlyArray<Vec2>, radius = 1.5): Vec2 => {
  let push: Vec2 = { x: 0, y: 0 }
  for (const o of others) {
    const away = sub(pos, o)
    const d = len(away)
    if (d > 1e-6 && d < radius) push = add(push, scale(norm(away), (radius - d) / radius))
  }
  return push
}

/**
 * Constant-bearing intercept: the point where a chaser at `speed` meets a target moving at
 * constant velocity. Falls back to the target's current position when no solution exists.
 */
export const interceptPoint = (chaser: Vec2, speed: number, target: Vec2, targetVel: Vec2): Vec2 => {
  const r = sub(target, chaser)
  const a = targetVel.x * targetVel.x + targetVel.y * targetVel.y - speed * speed
  const b = 2 * (r.x * targetVel.x + r.y * targetVel.y)
  const c = r.x * r.x + r.y * r.y
  let t: number
  if (Math.abs(a) < 1e-9) t = b !== 0 ? -c / b : -1
  else {
    const disc = b * b - 4 * a * c
    if (disc < 0) return target
    const s = Math.sqrt(disc)
    const t1 = (-b - s) / (2 * a)
    const t2 = (-b + s) / (2 * a)
    t = Math.min(...[t1, t2].filter((x) => x > 0), Infinity)
  }
  if (!Number.isFinite(t) || t <= 0) return target
  return add(target, scale(targetVel, t))
}
