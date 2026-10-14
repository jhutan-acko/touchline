/**
 * Off-ball anchors from the per-role rule table (realism v2, P2: A1, G4, A2; spec 2026-10-13). Pure functions of their
 * arguments; the state they read (rows, ball lag) lives in MatchState.anchor and drift in drift.ts.
 *
 * Team frame: u along the attack (u = +52.5 at the opponent's goal line), y toward the team's left when attacking;
 * bu, by are the ball's. Converted to pitch coordinates once, at the end, with dirOf(side, period).
 */
import { clamp, dirOf, PITCH, type Period, type Side, type Vec2 } from "./geometry.js"
import type { Params, PosGroup, PosRow, ShapeRow } from "./params.js"
import type { AnchorState, FormationName, Role, TeamShapeState, TeamStyle } from "./types.js"

export type Positioning = Params["positioning"]
/** A formation slot (the shape of shape.ts's Slot; kept structural so this module does not import shape.ts). */
export interface SlotDef { readonly role: Role; readonly x: number; readonly y: number }
/** shape.width (lateral), shape.depth (slot offsets) and shape.defDepth (slot offsets without the ball). */
export interface Spread { readonly width: number; readonly depth: number; readonly defDepth?: number }

/** League means of the style settings: the average side plays the real-data rows unchanged. */
export const LINE_HEIGHT_REF = 0.125
export const COMPACTNESS_REF = 0.625

/** A slot's positioning group: DM plays as CM; a full-back in a back three (3-5-2) as WB. */
export const groupOf = (formation: FormationName, slots: ReadonlyArray<SlotDef>, slot: number): PosGroup => {
  const r = slots[slot]!.role
  if (r === "FB" && formation === "3-5-2") return "WB"
  return r === "DM" ? "CM" : r
}

export interface SlotGeometry {
  readonly group: PosGroup
  /** The slot's x minus its group's mean slot x in the formation (within-role depth, m). */
  readonly dx: number
  /** Side of the pitch: 0 for a central slot (|y| < 3). */
  readonly sigma: -1 | 0 | 1
  /** |y| over the group's mean |y| among its side slots (0 for a central slot). */
  readonly sScale: number
  /** A 4-3-3 side central midfielder, whose lateral w0 is eightW0. */
  readonly eight: boolean
}

const geoCache = new Map<string, SlotGeometry>()
/** Geometry of a slot within its formation; `slots` must be FORMATIONS[formation] (memoised by formation and slot). */
export const slotGeometry = (formation: FormationName, slots: ReadonlyArray<SlotDef>, slot: number): SlotGeometry => {
  const key = `${formation}:${slot}`
  const hit = geoCache.get(key)
  if (hit) return hit
  const group = groupOf(formation, slots, slot)
  const same = slots.filter((_, i) => groupOf(formation, slots, i) === group)
  const meanX = same.reduce((a, q) => a + q.x, 0) / same.length
  const s = slots[slot]!
  const sigma: -1 | 0 | 1 = Math.abs(s.y) < 3 ? 0 : s.y > 0 ? 1 : -1
  const sides = same.filter((q) => Math.abs(q.y) >= 3)
  const meanAbsY = sides.length > 0 ? sides.reduce((a, q) => a + Math.abs(q.y), 0) / sides.length : 1
  const out: SlotGeometry = { group, dx: s.x - meanX, sigma, sScale: sigma === 0 ? 0 : Math.abs(s.y) / meanAbsY, eight: formation === "4-3-3" && group === "CM" && sigma !== 0 }
  geoCache.set(key, out)
  return out
}

export interface Blend {
  readonly from: ShapeRow
  readonly to: ShapeRow
  /** Share of the way from `from` to `to`: depth (lamU) and lateral (lamY). */
  readonly lamU: number
  readonly lamY: number
}

/** A blend that has arrived: the row alone. */
export const settled = (row: ShapeRow): Blend => ({ from: row, to: row, lamU: 1, lamY: 1 })

/**
 * How far a player of `group` has moved from his team's previous row into its current one (A2).
 * Depth: lambda = 1 - exp(-max(0, t + 0.5) / tau_group), t seconds since the switch.
 * Lateral: to "out" (a loss) narrows with narrowTauS; from "out" (a win) spreads after spreadDeadS with spreadTauS;
 * within possession (in <-> gk) it follows lambda.
 */
export const blendFor = (team: TeamShapeState, group: PosGroup, tick: number, dt: number, pos: Positioning): Blend => {
  if (team.prev === team.row) return settled(team.row)
  const t = (tick - team.since) * dt
  const lamU = 1 - Math.exp(-Math.max(0, t + 0.5) / pos.tauS[group])
  const lamY =
    team.row === "out"
      ? 1 - Math.exp(-Math.max(0, t) / pos.narrowTauS)
      : team.prev === "out"
        ? 1 - Math.exp(-Math.max(0, t - pos.spreadDeadS) / pos.spreadTauS)
        : lamU
  return { from: team.prev, to: team.row, lamU, lamY }
}

/** One row's spot in the team frame, before blending: the table, the slot's offsets, style (without the ball only) and spread. */
const rowSpot = (row: ShapeRow, r: PosRow, geo: SlotGeometry, bu: number, by: number, style: TeamStyle, spread: Spread, pos: Positioning): { u: number; y: number } => {
  const out = row === "out"
  const depth = spread.depth * (out ? (spread.defDepth ?? 1) : 1)
  const u = r.a + r.b * bu + geo.dx * depth + (out ? pos.styleLineM * (style.lineHeight - LINE_HEIGHT_REF) : 0)
  if (geo.sigma === 0) return { u, y: r.e * by }
  const width = out ? 1 + (spread.width - 1) * 0.4 : spread.width
  const compact = out ? 1 - pos.styleCompact * (style.compactness - COMPACTNESS_REF) : 1
  const w0 = (geo.eight ? pos.eightW0 : r.w0 * geo.sScale) * width * compact
  // sigma * w2 * (sigma * by) = w2 * by: the ball on the player's own side pulls him wider, on the far side narrower.
  return { u, y: geo.sigma * (w0 + r.w1 * bu + r.w3 * Math.abs(by)) + r.w2 * by }
}

/** The keeper: within keeperNearM of his goal, keeperLineM off the line on the goal-ball line; else his row, clamped. */
const keeperSpot = (u: number, y: number, bu: number, by: number, pos: Positioning): { u: number; y: number } => {
  const fromLine = bu + PITCH.halfL
  if (Math.hypot(fromLine, by) < pos.keeperNearM)
    return { u: -PITCH.halfL + pos.keeperLineM, y: clamp((by * pos.keeperLineM) / Math.max(1, fromLine), -PITCH.goalHalfWidth, PITCH.goalHalfWidth) }
  return { u: clamp(u, -51, -20), y: clamp(y, -6, 6) }
}

export interface AnchorInput {
  readonly blend: Blend
  /** Summed drift for this player in the team frame (drift.ts driftFor); zero for keepers. */
  readonly drift: { readonly u: number; readonly y: number }
  /** The opponents' last outfield defender in this side's attack frame, or null for no cap. */
  readonly lastDefU: number | null
  /** The other team's keeper has the ball. */
  readonly vsKeeper: boolean
}

/** The rule-table anchor in pitch coordinates (`ball` is the ball as the anchor reads it: lagged in open play). */
export const ruleAnchor = (
  formation: FormationName,
  slots: ReadonlyArray<SlotDef>,
  slot: number,
  side: Side,
  period: Period,
  ball: Vec2,
  style: TeamStyle,
  spread: Spread,
  pos: Positioning,
  input: AnchorInput
): Vec2 => {
  const d = dirOf(side, period)
  const bu = ball.x * d
  const by = ball.y * d
  const geo = slotGeometry(formation, slots, slot)
  const rows = pos.roles[geo.group]
  const { from, to, lamU, lamY } = input.blend
  const a = rowSpot(from, rows[from], geo, bu, by, style, spread, pos)
  const b = from === to ? a : rowSpot(to, rows[to], geo, bu, by, style, spread, pos)
  let u = a.u + lamU * (b.u - a.u)
  let y = a.y + lamY * (b.y - a.y)
  if (geo.group === "GK") {
    const k = keeperSpot(u, y, bu, by, pos)
    return { x: k.u * d, y: k.y * d }
  }
  u += input.drift.u
  y += input.drift.y
  if (to !== "out" && input.lastDefU !== null && (geo.group === "ST" || geo.group === "W" || geo.group === "AM")) u = Math.min(u, input.lastDefU - pos.lineCapM)
  if (to === "out" && input.vsKeeper) u = Math.min(u, pos.vsKeeperCapU)
  u = clamp(u, -PITCH.halfL + 4, PITCH.halfL - 3)
  y = clamp(y, -PITCH.halfW + 1.5, PITCH.halfW - 1.5)
  return { x: u * d, y: y * d }
}

/** A team's row from who has the ball; null (loose or dead, no restart) keeps the previous row. */
export const rowFor = (side: Side, possSide: Side | null, keeperHasIt: boolean, previous: ShapeRow): ShapeRow =>
  possSide === null ? previous : possSide === side ? (keeperHasIt ? "gk" : "in") : "out"

/** A fresh state: the ball ring filled with the current ball, both teams settled in their rows, no drift yet. */
export const initAnchorState = (ball: Vec2, dt: number, pos: Positioning, rows: Readonly<Record<Side, ShapeRow>>): AnchorState => ({
  ballLag: Array.from({ length: Math.max(1, Math.round(pos.ballLagS / dt)) + 1 }, () => ball),
  teams: {
    home: { row: rows.home, prev: rows.home, since: 0, drift: { u: 0, y: 0 } },
    away: { row: rows.away, prev: rows.away, since: 0, drift: { u: 0, y: 0 } }
  },
  players: {}
})

/** One tick: push the ball onto the ring, and start a blend for each team whose row changed (drift is left alone). */
export const advanceRows = (s: AnchorState, tick: number, ball: Vec2, rows: Readonly<Record<Side, ShapeRow>>): AnchorState => {
  const team = (side: Side): TeamShapeState => {
    const t = s.teams[side]
    return rows[side] === t.row ? t : { ...t, prev: t.row, row: rows[side], since: tick }
  }
  return { ...s, ballLag: [...s.ballLag.slice(1), ball], teams: { home: team("home"), away: team("away") } }
}

/** The ball as anchors read it: ballLagS ago. */
export const lagBall = (s: AnchorState): Vec2 => s.ballLag[0]!
