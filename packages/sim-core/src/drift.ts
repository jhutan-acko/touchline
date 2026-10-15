/**
 * Drift around the rule-table anchor (realism v2, P2: A3; offball-report.md): a team-common Ornstein-Uhlenbeck shift of
 * the whole block, and per outfield player a match offset (with and without the ball, drawn once) plus a slow OU drift.
 * Team frame (u along the attack, y toward the team's left when attacking); s is toward the player's own touchline.
 * Draws only from the `drift` RNG stream.
 */
import type { Side } from "./geometry.js"
import type { Params, PosGroup, ShapeRow } from "./params.js"
import type { Rng } from "./rng.js"
import type { AnchorState, PlayerDriftState, TeamShapeState } from "./types.js"

export type DriftParams = Params["positioning"]["drift"]

/** A newcomer's drift: match offsets with and without the ball, and a slow drift started from its stationary spread. */
export const newPlayerDrift = (group: PosGroup, d: DriftParams, rng: Rng): PlayerDriftState => {
  const draw = (sd: number) => (sd > 0 ? sd * rng.normal() : 0)
  const offIn = { u: draw(d.offsetUSdM[group]), s: draw(d.offsetSSdM[group]) }
  const offOut = { u: draw(d.offsetUSdM[group]), s: draw(d.offsetSSdM[group]) }
  // GK branches: defensive (the keeper has no depth drift; rows never move a GK by it).
  const slow = { u: group === "GK" ? 0 : draw(d.playerUSdM), s: draw(d.playerSSdM[group]) }
  return { offIn, offOut, slow }
}

/**
 * One exact step of a smoothed OU (Task 7d): a raw OU x (time constant tauS - smoothS) passed through a first-order
 * low-pass z (time constant smoothS), dz = (x - z) / smoothS dt. z is the drift the anchors read: its path is smooth (a
 * per-tick change of about sd dt / sqrt(smoothS (tauS - smoothS)), not sd sqrt(2 dt / tauS)), its stationary SD is `sd` and its
 * autocorrelation at lag tauS stays within about 0.01 of e^-1 (the integral time scale is exactly tauS).
 * The joint (x, z) step is the exact discretisation of the linear SDE: the mean by the transition matrix, the noise by
 * the Cholesky factor of its covariance. Always draws exactly two normals (whatever sd, tauS and smoothS), so the
 * draw count does not depend on the params. smoothS is limited to tauS / 3; smoothS <= 0 is the plain OU (z = x).
 * sd <= 0: both 0.
 */
export const smoothOuStep = (x: number, z: number, sd: number, tauS: number, smoothS: number, dt: number, rng: Rng): { x: number; z: number } => {
  const n1 = rng.normal()
  const n2 = rng.normal()
  if (sd <= 0) return { x: 0, z: 0 }
  // A frozen step (dt 0, the drift's dead-ball rate at 0) still draws, so the draw count stays independent of the params.
  if (dt <= 0) return { x, z }
  const ts = Math.min(smoothS, tauS / 3)
  if (ts <= 0) {
    const k = Math.exp(-dt / tauS)
    const v = x * k + sd * Math.sqrt(1 - k * k) * n1
    return { x: v, z: v }
  }
  const tr = tauS - ts
  // Raw stationary variance so that var z = sx2 tr / (tr + ts) = sd^2; diffusion q = 2 sx2 / tr.
  const sx2 = (sd * sd * tauS) / tr
  const q = (2 * sx2) / tr
  const a = Math.exp(-dt / tr)
  const b = Math.exp(-dt / ts)
  const kk = tr / (tr - ts)
  const h = (tr * ts) / (tr + ts)
  const ia = (-tr / 2) * Math.expm1((-2 * dt) / tr) // integral of e^(-2s/tr) over [0, dt]
  const ib = (-ts / 2) * Math.expm1((-2 * dt) / ts)
  const iab = -h * Math.expm1(-dt / h)
  const qxx = q * ia
  const qxz = q * kk * (ia - iab)
  const qzz = q * kk * kk * (ia - 2 * iab + ib)
  const l11 = Math.sqrt(qxx)
  const l21 = qxz / l11
  const l22 = Math.sqrt(Math.max(0, qzz - l21 * l21))
  return { x: a * x + l11 * n1, z: b * z + kk * (a - b) * x + l21 * n1 + l22 * n2 }
}

/**
 * One tick of drift: both teams' shifts (home u, y, then away u, y), then each listed player's slow u and s (a
 * newcomer's 6 draws first). Each process is a smoothed OU (smoothOuStep, two draws); the raw OU behind it lives in
 * driftRaw / raw (absent: the smoothed value).
 */
export const advanceDrift = (s: AnchorState, players: ReadonlyArray<{ readonly id: string; readonly group: PosGroup }>, dt: number, d: DriftParams, rng: Rng): AnchorState => {
  const team = (t: TeamShapeState): TeamShapeState => {
    const raw = t.driftRaw ?? t.drift
    const u = smoothOuStep(raw.u, t.drift.u, d.teamUSdM, d.teamUTauS, d.smoothS, dt, rng)
    const y = smoothOuStep(raw.y, t.drift.y, d.teamYSdM, d.teamYTauS, d.smoothS, dt, rng)
    return { ...t, drift: { u: u.z, y: y.z }, driftRaw: { u: u.x, y: y.x } }
  }
  const home = team(s.teams.home)
  const away = team(s.teams.away)
  const out: Record<string, PlayerDriftState> = { ...s.players }
  for (const { id, group } of players) {
    const cur = out[id] ?? newPlayerDrift(group, d, rng)
    const raw = cur.raw ?? cur.slow
    // GK: defensive (no depth drift for a keeper, as in newPlayerDrift).
    const u = smoothOuStep(raw.u, cur.slow.u, group === "GK" ? 0 : d.playerUSdM, d.playerUTauS, d.smoothS, dt, rng)
    const sl = smoothOuStep(raw.s, cur.slow.s, d.playerSSdM[group], d.playerSTauS[group], d.smoothS, dt, rng)
    out[id] = { ...cur, slow: { u: u.z, s: sl.z }, raw: { u: u.x, s: sl.x } }
  }
  return { ...s, teams: { home, away }, players: out }
}

/**
 * A player's summed drift in the team frame under a blend from `from` to `to` (no entry: the team's shift alone). uScale
 * scales the player's own depth drift (offsets and slow u), not the team's shift (positioning.drift.backLineOutU).
 */
export const driftFor = (s: AnchorState, side: Side, playerId: string, lamU: number, lamY: number, from: ShapeRow, to: ShapeRow, sigma: -1 | 0 | 1, uScale = 1, sScale = 1): { u: number; y: number } => {
  const t = s.teams[side].drift
  const p = s.players[playerId]
  if (!p) return { u: t.u, y: t.y }
  const off = (row: ShapeRow) => (row === "out" ? p.offOut : p.offIn)
  const a = off(from)
  const b = off(to)
  const sgn = sigma === 0 ? 1 : sigma
  // uScale 1 keeps the original sum order, so a run without the back-line damping stays bit-identical.
  const u = uScale === 1 ? t.u + a.u + lamU * (b.u - a.u) + p.slow.u : t.u + uScale * (a.u + lamU * (b.u - a.u) + p.slow.u)
  const y = sScale === 1 ? t.y + sgn * (a.s + lamY * (b.s - a.s) + p.slow.s) : t.y + sgn * sScale * (a.s + lamY * (b.s - a.s) + p.slow.s)
  return { u, y }
}
