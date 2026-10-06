/**
 * Pitch control (Spearman, "Beyond Expected Goals", 2018): the probability that each team gains the ball if it
 * is played to a point. A port of `calculate_pitch_control_at_target` from LaurieOnTracking's
 * Metrica_PitchControl.py (MIT, Friends of Tracking; see ATTRIBUTION.md), with its default parameters.
 * Shared by the engine (passers weigh it, see decide.ts) and the stats engine (`pitch.ctrl`).
 *
 * Ported from LaurieOnTracking (https://github.com/Friends-of-Tracking-Data-FoTD/LaurieOnTracking), whose licence follows:
 *
 * MIT License
 *
 * Copyright (c) 2021 Friends-of-Tracking-Data-FoTD
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import { PITCH, type Vec2 } from "./geometry.js"

export interface PcPlayer {
  readonly x: number
  readonly y: number
  /** Velocity (m/s); 0 when unknown. */
  readonly vx: number
  readonly vy: number
  /** Keepers control the ball faster (they can catch it). */
  readonly gk: boolean
}

export interface PitchControlParams {
  /** Top speed (m/s). */
  readonly vmax: number
  /** Seconds a player keeps moving at their current velocity before changing course. */
  readonly reactionS: number
  /** Uncertainty (s) in a player's arrival time. */
  readonly ttiSigma: number
  /** Ball-control rates (1/s) for attackers, defenders and keepers. */
  readonly lambdaAtt: number
  readonly lambdaDef: number
  readonly lambdaGk: number
  /** Assumed average ball speed (m/s) for the time of flight. */
  readonly ballSpeed: number
  readonly intDt: number
  readonly maxIntS: number
  readonly convergeTol: number
}

export const PC_DEFAULTS: PitchControlParams = { vmax: 5, reactionS: 0.7, ttiSigma: 0.45, lambdaAtt: 4.3, lambdaDef: 4.3, lambdaGk: 12.9, ballSpeed: 15, intDt: 0.04, maxIntS: 10, convergeTol: 0.01 }

/** A team arriving this long after the other cannot take control (3 x log 10 control time scales). */
const timeToControl = (p: PitchControlParams, lambda: number) => 3 * Math.log(10) * ((Math.sqrt(3) * p.ttiSigma) / Math.PI + 1 / lambda)

const timeToIntercept = (pl: PcPlayer, target: Vec2, p: PitchControlParams): number => {
  const rx = pl.x + pl.vx * p.reactionS
  const ry = pl.y + pl.vy * p.reactionS
  return p.reactionS + Math.hypot(target.x - rx, target.y - ry) / p.vmax
}

export interface PitchControl {
  /** Probability the attacking team (the one playing the ball) gains it at the target. */
  readonly att: number
  readonly def: number
}

/**
 * Pitch control at `target` for a ball played from `ballStart` (null: the ball is already there). The integration
 * stops once both teams' control sums to 1 - convergeTol, as in the reference.
 */
export const pitchControlAt = (target: Vec2, attackers: ReadonlyArray<PcPlayer>, defenders: ReadonlyArray<PcPlayer>, ballStart: Vec2 | null, p: PitchControlParams = PC_DEFAULTS): PitchControl => {
  if (attackers.length === 0 || defenders.length === 0) return attackers.length ? { att: 1, def: 0 } : { att: 0, def: 1 }
  const travel = ballStart === null ? 0 : Math.hypot(target.x - ballStart.x, target.y - ballStart.y) / p.ballSpeed
  const att = attackers.map((pl) => ({ tti: timeToIntercept(pl, target, p), lambda: p.lambdaAtt, ppcf: 0 }))
  const def = defenders.map((pl) => ({ tti: timeToIntercept(pl, target, p), lambda: pl.gk ? p.lambdaGk : p.lambdaDef, ppcf: 0 }))
  const tauAtt = Math.min(...att.map((a) => a.tti))
  const tauDef = Math.min(...def.map((d) => d.tti))
  const ttcAtt = timeToControl(p, p.lambdaAtt)
  const ttcDef = timeToControl(p, p.lambdaDef)
  if (tauAtt - Math.max(travel, tauDef) >= ttcDef) return { att: 0, def: 1 }
  if (tauDef - Math.max(travel, tauAtt) >= ttcAtt) return { att: 1, def: 0 }
  const a = att.filter((x) => x.tti - tauAtt < ttcAtt)
  const d = def.filter((x) => x.tti - tauDef < ttcDef)
  const k = (Math.PI / Math.sqrt(3)) / p.ttiSigma
  const steps = Math.floor((p.maxIntS + p.intDt) / p.intDt - 1e-9) + 1
  let prevAtt = 0
  let prevDef = 0
  let i = 1
  for (; i < steps && 1 - (prevAtt + prevDef) > p.convergeTol; i++) {
    const t = travel - p.intDt + i * p.intDt
    let sumAtt = 0
    let sumDef = 0
    for (const x of a) {
      x.ppcf += (1 - prevAtt - prevDef) * (1 / (1 + Math.exp(-k * (t - x.tti)))) * x.lambda * p.intDt
      sumAtt += x.ppcf
    }
    for (const x of d) {
      x.ppcf += (1 - prevAtt - prevDef) * (1 / (1 + Math.exp(-k * (t - x.tti)))) * x.lambda * p.intDt
      sumDef += x.ppcf
    }
    prevAtt = sumAtt
    prevDef = sumDef
  }
  return { att: prevAtt, def: prevDef }
}

export interface PitchControlGrid {
  readonly cols: number
  readonly rows: number
  /** Attacking control per cell, row-major, row 0 at y = -34, column 0 at x = -52.5. */
  readonly att: ReadonlyArray<number>
}

/** Pitch control for the attacking team at every cell centre of a cols x rows grid, for a ball played from `ball`. */
export const pitchControlGrid = (attackers: ReadonlyArray<PcPlayer>, defenders: ReadonlyArray<PcPlayer>, ball: Vec2 | null, cols = 21, rows = 14, p: PitchControlParams = PC_DEFAULTS): PitchControlGrid => {
  const att: number[] = []
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const target = { x: -PITCH.halfL + ((c + 0.5) * PITCH.length) / cols, y: -PITCH.halfW + ((r + 0.5) * PITCH.width) / rows }
      att.push(pitchControlAt(target, attackers, defenders, ball, p).att)
    }
  return { cols, rows, att }
}
