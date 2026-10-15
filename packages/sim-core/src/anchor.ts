/**
 * Off-ball anchors from the per-role rule table (realism v2, P2: A1, G4, A2; spec 2026-10-13). Pure functions of their
 * arguments; the state they read (rows, ball lag) lives in MatchState.anchor and drift in drift.ts.
 *
 * Team frame: u along the attack (u = +52.5 at the opponent's goal line), y toward the team's left when attacking;
 * bu, by are the ball's. Converted to pitch coordinates once, at the end, with dirOf(side, period).
 */
import { clamp, dirOf, PITCH, type Period, type Side, type Vec2 } from "./geometry.js"
import type { Params, PosGroup, PosRow, ShapeRow } from "./params.js"
import type { AnchorState, FormationName, Role, RowMix, TeamShapeState, TeamStyle } from "./types.js"

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
  /**
   * The weights the anchor mixes (blendFor): from where the blend started toward the target, by lamU and lamY. Absent
   * (settled, hand-built blends): from `from` alone to `to`, which is outK when the input says the other keeper has the ball.
   */
  readonly mix?: { readonly u: RowMix; readonly y: RowMix }
}

/** A blend that has arrived: the row alone. */
export const settled = (row: ShapeRow): Blend => ({ from: row, to: row, lamU: 1, lamY: 1 })

/** The spots a team blends between: the rows, and "out" capped at vsKeeperCapU (outK; drift is added after, so it can carry an anchor past the cap). */
export type MixKey = keyof RowMix
const KEYS: ReadonlyArray<MixKey> = ["in", "out", "gk", "outK"]
const ZERO: RowMix = { in: 0, out: 0, gk: 0, outK: 0 }
const only = (k: MixKey): RowMix => ({ ...ZERO, [k]: 1 })
/** (1 - lam) a + lam b. */
const lerpMix = (a: RowMix, b: RowMix, lam: number): RowMix => ({
  in: a.in + lam * (b.in - a.in),
  out: a.out + lam * (b.out - a.out),
  gk: a.gk + lam * (b.gk - a.gk),
  outK: a.outK + lam * (b.outK - a.outK)
})
/** A team's target spot: its row, or outK while it is out and the other keeper has the ball. */
export const targetKey = (team: TeamShapeState): MixKey => (team.row === "out" && team.capped ? "outK" : team.row)

/**
 * How far a player of `group` has moved from his team's previous row into its current one (A2).
 * Depth: lambda = 1 - exp(-max(0, t + 0.5) / tau_group), t seconds since the switch.
 * Lateral: to "out" (a loss) narrows with narrowTauS; from "out" (a win) spreads after spreadDeadS with spreadTauS;
 * within possession (in <-> gk) it follows lambda.
 */
export const blendFor = (team: TeamShapeState, group: PosGroup, tick: number, dt: number, pos: Positioning): Blend => {
  const to = targetKey(team)
  if (team.prev === team.row && !team.start) return to === team.row ? settled(team.row) : { ...settled(team.row), mix: { u: only(to), y: only(to) } }
  const t = (tick - team.since) * dt
  const tau = team.row === "gk" && pos.gkTauS > 0 ? pos.gkTauS : pos.tauS[group]
  const lamU = 1 - Math.exp(-Math.max(0, t + 0.5) / tau)
  const lamY =
    team.row === "out"
      ? 1 - Math.exp(-Math.max(0, t) / pos.narrowTauS)
      : team.prev === "out"
        ? 1 - Math.exp(-Math.max(0, t - pos.spreadDeadS) / pos.spreadTauS)
        : lamU
  const target = only(to)
  // Arrived to within 1e-6: the target alone, so a settled team does not keep evaluating the rows it left.
  if (lamU > 1 - 1e-6 && lamY > 1 - 1e-6) return { from: team.prev, to: team.row, lamU, lamY, mix: { u: target, y: target } }
  // Continuity (Task 7b): the blend starts where the last one stood at the switch, not at the previous row in full.
  const start = team.start?.[group] ?? { u: only(team.prev), y: only(team.prev) }
  return { from: team.prev, to: team.row, lamU, lamY, mix: { u: lerpMix(start.u, target, lamU), y: lerpMix(start.y, target, lamY) } }
}

/** The mix a blend without one stands for: `from` to `to` by lamU / lamY, the target capped (outK) if vsKeeper. */
const mixOf = (blend: Blend, vsKeeper: boolean): { u: RowMix; y: RowMix } => {
  if (blend.mix) return blend.mix
  const a = only(blend.from)
  const b = only(blend.to === "out" && vsKeeper ? "outK" : blend.to)
  return { u: lerpMix(a, b, blend.lamU), y: lerpMix(a, b, blend.lamY) }
}

/** The share of a mix played without the ball (the drift offsets' offOut weight). */
export const outShare = (m: RowMix): number => m.out + m.outK

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

/**
 * The keeper: keeperLineM off the line on the goal-ball line while the ball is within keeperNearInM of his goal, his row
 * (clamped) beyond keeperNearOutM, and linearly between the two in between.
 */
const keeperSpot = (u: number, y: number, bu: number, by: number, pos: Positioning): { u: number; y: number } => {
  const fromLine = bu + PITCH.halfL
  const d = Math.hypot(fromLine, by)
  const row = { u: clamp(u, -51, -20), y: clamp(y, -6, 6) }
  if (d >= pos.keeperNearOutM) return row
  const line = { u: -PITCH.halfL + pos.keeperLineM, y: clamp((by * pos.keeperLineM) / Math.max(1, fromLine), -PITCH.goalHalfWidth, PITCH.goalHalfWidth) }
  if (d <= pos.keeperNearInM) return line
  const f = (d - pos.keeperNearInM) / (pos.keeperNearOutM - pos.keeperNearInM)
  return { u: line.u + f * (row.u - line.u), y: line.y + f * (row.y - line.y) }
}

export interface AnchorInput {
  readonly blend: Blend
  /** Summed drift for this player in the team frame (drift.ts driftFor); zero for keepers. */
  readonly drift: { readonly u: number; readonly y: number }
  /** The opponents' last outfield defender in this side's attack frame, or null for no cap. */
  readonly lastDefU: number | null
  /** The other team's keeper has the ball (read only for a blend without a mix: blendFor's mix carries the cap itself). */
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
  const mix = mixOf(input.blend, input.vsKeeper)
  // The forward-line cap (Task 7d): forwards (ST, W, AM) keep lineCapM below the opponents' last defender in the rows
  // with the ball (in, gk). It caps those row spots, drift included, before blending, so it eases in and out at the
  // group's rate on a change of possession and follows lastDefU continuously; settled in a row with the ball it is the
  // hard cap on the drifted spot, as before.
  const lineCap = input.lastDefU !== null && (geo.group === "ST" || geo.group === "W" || geo.group === "AM") ? input.lastDefU - pos.lineCapM : null
  // Each spot in the mix (at most four rowSpots); outK is the out spot with its depth capped before blending, so the
  // cap eases in and out at the group's rate (keepers are not capped).
  let u = 0
  let y = 0
  let outSpot: { u: number; y: number } | null = null
  for (const k of KEYS) {
    const wu = mix.u[k]
    const wy = mix.y[k]
    if (wu === 0 && wy === 0) continue
    const row: ShapeRow = k === "outK" ? "out" : k
    const spot = row === "out" ? (outSpot ??= rowSpot("out", rows.out, geo, bu, by, style, spread, pos)) : rowSpot(row, rows[row], geo, bu, by, style, spread, pos)
    let su = k === "outK" && geo.group !== "GK" ? Math.min(spot.u, pos.vsKeeperCapU) : spot.u
    if (lineCap !== null && (k === "in" || k === "gk")) su = Math.min(su + input.drift.u, lineCap) - input.drift.u
    u += wu * su
    y += wy * spot.y
  }
  if (geo.group === "GK") {
    const k = keeperSpot(u, y, bu, by, pos)
    return { x: k.u * d, y: k.y * d }
  }
  // The mix weights sum to 1, so the drift added here is the drift each capped spot above was measured with.
  u += input.drift.u
  y += input.drift.y
  u = clamp(u, -PITCH.halfL + 4, PITCH.halfL - 3)
  y = clamp(y, -PITCH.halfW + 1.5, PITCH.halfW - 1.5)
  return { x: u * d, y: y * d }
}

/** A team's row from who has the ball; null (loose or dead, no restart) keeps the previous row. */
export const rowFor = (side: Side, possSide: Side | null, keeperHasIt: boolean, previous: ShapeRow): ShapeRow =>
  possSide === null ? previous : possSide === side ? (keeperHasIt ? "gk" : "in") : "out"

/** Whether `side`, in `rows`, is out of possession while the other team's keeper has the ball (its target is outK). */
const cappedIn = (side: Side, rows: Readonly<Record<Side, ShapeRow>>): boolean => rows[side] === "out" && rows[side === "home" ? "away" : "home"] === "gk"

/** A fresh state: the ball ring filled with the current ball, both teams settled in their rows, no drift yet. */
export const initAnchorState = (ball: Vec2, dt: number, pos: Positioning, rows: Readonly<Record<Side, ShapeRow>>): AnchorState => {
  const team = (side: Side): TeamShapeState => {
    const t: TeamShapeState = { row: rows[side], prev: rows[side], since: 0, drift: { u: 0, y: 0 } }
    return cappedIn(side, rows) ? { ...t, capped: true } : t
  }
  return {
    ballLag: Array.from({ length: Math.max(1, Math.round(pos.ballLagS / dt)) + 1 }, () => ball),
    teams: { home: team("home"), away: team("away") },
    players: {}
  }
}

const GROUPS: ReadonlyArray<PosGroup> = ["GK", "CB", "FB", "WB", "CM", "AM", "W", "ST"]

/**
 * One tick: push the ball onto the ring, and start a blend for each team whose target changed (its row, or the vsKeeper
 * cap coming on or off while it is out). The new blend starts where the old one stands at `tick`, per group (drift is
 * left alone).
 */
export const advanceRows = (s: AnchorState, tick: number, ball: Vec2, rows: Readonly<Record<Side, ShapeRow>>, dt: number, pos: Positioning): AnchorState => {
  const team = (side: Side): TeamShapeState => {
    const t = s.teams[side]
    const capped = cappedIn(side, rows)
    if (rows[side] === t.row && capped === (t.capped ?? false)) return t
    const start = {} as Record<PosGroup, { u: RowMix; y: RowMix }>
    for (const g of GROUPS) {
      const b = blendFor(t, g, tick, dt, pos)
      start[g] = mixOf(b, false)
    }
    const { capped: _, ...rest } = t
    return { ...rest, prev: t.row, row: rows[side], since: tick, start, ...(capped ? { capped } : {}) }
  }
  return { ...s, ballLag: [...s.ballLag.slice(1), ball], teams: { home: team("home"), away: team("away") } }
}

/** Fill the ball ring with one spot (a restart being set up, or the start of a period) and record the period. */
export const holdBall = (s: AnchorState, ball: Vec2, period: Period): AnchorState => ({ ...s, ballLag: s.ballLag.map(() => ball), period })

/**
 * The side the rows follow this tick, with the possession-commit debounce (positioning.commitS): a new side in possession
 * (`raw`) must keep the ball `commitTicks` ticks before the rows switch to it, unless `immediate` (a restart, a keeper's
 * catch). `committed` is the side the rows follow now (null: none yet). Returns the side to apply (null: keep the rows)
 * and the pending side, if any. commitTicks 0 applies `raw` at once.
 */
export const commitSide = (
  committed: Side | null,
  raw: Side | null,
  immediate: boolean,
  pending: { readonly side: Side; readonly since: number } | undefined,
  tick: number,
  commitTicks: number
): { side: Side | null; pending: { readonly side: Side; readonly since: number } | undefined } => {
  if (raw === null) return { side: null, pending }
  if (raw === committed || committed === null || immediate || commitTicks <= 0) return { side: raw, pending: undefined }
  const p = pending?.side === raw ? pending : { side: raw, since: tick }
  return tick - p.since >= commitTicks ? { side: raw, pending: undefined } : { side: null, pending: p }
}

/** The ball as anchors read it: ballLagS ago. */
export const lagBall = (s: AnchorState): Vec2 => s.ballLag[0]!
