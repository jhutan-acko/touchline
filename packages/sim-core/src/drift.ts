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

/** One exact OU step: x e^(-dt/tau) + sd sqrt(1 - e^(-2 dt/tau)) N(0, 1); stationary SD `sd` at any dt. sd <= 0: 0, no draw. */
export const ouStep = (x: number, sd: number, tauS: number, dt: number, rng: Rng): number => {
  if (sd <= 0) return 0
  const k = Math.exp(-dt / tauS)
  return x * k + sd * Math.sqrt(1 - k * k) * rng.normal()
}

/** A newcomer's drift: match offsets with and without the ball, and a slow drift started from its stationary spread. */
export const newPlayerDrift = (group: PosGroup, d: DriftParams, rng: Rng): PlayerDriftState => {
  const draw = (sd: number) => (sd > 0 ? sd * rng.normal() : 0)
  const offIn = { u: draw(d.offsetUSdM[group]), s: draw(d.offsetSSdM[group]) }
  const offOut = { u: draw(d.offsetUSdM[group]), s: draw(d.offsetSSdM[group]) }
  const slow = { u: group === "GK" ? 0 : draw(d.playerUSdM), s: draw(d.playerSSdM[group]) }
  return { offIn, offOut, slow }
}

/** One tick of drift: both teams' shifts (home, then away), then each listed player's (newcomers drawn first). */
export const advanceDrift = (s: AnchorState, players: ReadonlyArray<{ readonly id: string; readonly group: PosGroup }>, dt: number, d: DriftParams, rng: Rng): AnchorState => {
  const team = (t: TeamShapeState): TeamShapeState => {
    const u = ouStep(t.drift.u, d.teamUSdM, d.teamUTauS, dt, rng)
    const y = ouStep(t.drift.y, d.teamYSdM, d.teamYTauS, dt, rng)
    return { ...t, drift: { u, y } }
  }
  const home = team(s.teams.home)
  const away = team(s.teams.away)
  const out: Record<string, PlayerDriftState> = { ...s.players }
  for (const { id, group } of players) {
    const cur = out[id] ?? newPlayerDrift(group, d, rng)
    const u = group === "GK" ? 0 : ouStep(cur.slow.u, d.playerUSdM, d.playerUTauS, dt, rng)
    const sl = ouStep(cur.slow.s, d.playerSSdM[group], d.playerSTauS[group], dt, rng)
    out[id] = { ...cur, slow: { u, s: sl } }
  }
  return { ...s, teams: { home, away }, players: out }
}

/** A player's summed drift in the team frame under a blend from `from` to `to` (no entry: the team's shift alone). */
export const driftFor = (s: AnchorState, side: Side, playerId: string, lamU: number, lamY: number, from: ShapeRow, to: ShapeRow, sigma: -1 | 0 | 1): { u: number; y: number } => {
  const t = s.teams[side].drift
  const p = s.players[playerId]
  if (!p) return { u: t.u, y: t.y }
  const off = (row: ShapeRow) => (row === "out" ? p.offOut : p.offIn)
  const a = off(from)
  const b = off(to)
  const sgn = sigma === 0 ? 1 : sigma
  return { u: t.u + a.u + lamU * (b.u - a.u) + p.slow.u, y: t.y + sgn * (a.s + lamY * (b.s - a.s) + p.slow.s) }
}
