/**
 * Manager orders (Plan 4b): what a team's manager may change at a stoppage — its style settings and substitutions.
 * Orders are checked against the live state first. A style change takes effect at once; a substitution is queued and
 * made at the start of the next tick by the engine's substitution code, counting against the laws' limits.
 */
import type { Side } from "./geometry.js"
import type { MatchState, PlayerSetup, TeamStyle } from "./types.js"

/** Laws of the game: five substitutions, made in at most three stoppages during play (half time does not count). */
export const MAX_SUBS = 5
export const MAX_SUB_WINDOWS = 3

export type StyleKey = keyof Omit<TeamStyle, "archetype">

/** The range each style setting may take. */
export const STYLE_RANGES: Readonly<Record<StyleKey, readonly [number, number]>> = {
  pressIntensity: [0, 1],
  lineHeight: [-1, 1],
  compactness: [0, 1],
  tempo: [0, 1],
  longBallBias: [-1, 1],
  crossBias: [-1, 1],
  riskTolerance: [0, 1]
}

export interface SubOrder {
  readonly off: string
  readonly on: string
}

export type ManagerOrder =
  /** One style setting to a new value (one setting per order keeps the order a fixed shape for the model). */
  | { readonly kind: "style"; readonly setting: StyleKey; readonly value: number }
  | ({ readonly kind: "sub" } & SubOrder)

/** An order that cannot be applied to the state. */
export class OrderError extends Error {}

/** True at the second-half kickoff, before play: substitutions made now are half-time changes (no window used). */
export const isHalfTimeBreak = (s: MatchState): boolean => s.period === "second_half" && s.periodTick === 0 && s.phase.kind === "restart"

const queued = (s: MatchState, side: Side): ReadonlyArray<SubOrder> => s.subOrders?.[side] ?? []

/** Substitutions the team may still make (queued ones count). */
export const subsLeft = (s: MatchState, side: Side): number => MAX_SUBS - s.subs[side].made - queued(s, side).length

/** Stoppages during play in which the team may still substitute. */
export const windowsLeft = (s: MatchState, side: Side): number => MAX_SUB_WINDOWS - s.subs[side].windows

/** The team's bench players who have not come on yet. */
export const availableBench = (s: MatchState, side: Side): ReadonlyArray<PlayerSetup> => {
  const used = new Set([...s.subs[side].used, ...queued(s, side).map((q) => q.on)])
  return (s.config[side].bench ?? []).filter((b) => !used.has(b.id))
}

/** Why `order` cannot be applied for `side` now, after the orders already accepted; null when it can. */
export const orderProblem = (s: MatchState, side: Side, order: ManagerOrder, accepted: ReadonlyArray<ManagerOrder> = []): string | null => {
  if (order.kind === "style") {
    const range = Object.hasOwn(STYLE_RANGES, order.setting) ? STYLE_RANGES[order.setting] : undefined
    if (!range) return `unknown style setting "${order.setting}"`
    if (typeof order.value !== "number" || !(order.value >= range[0] && order.value <= range[1])) return `${order.setting} must be between ${range[0]} and ${range[1]}`
    if (accepted.some((o) => o.kind === "style" && o.setting === order.setting)) return `${order.setting} is already being changed`
    return null
  }
  if (s.phase.kind !== "restart") return "substitutions are made only at a stoppage"
  const subs = accepted.filter((o): o is Extract<ManagerOrder, { kind: "sub" }> => o.kind === "sub")
  if (subs.length + 1 > subsLeft(s, side)) return `no substitutions left (${MAX_SUBS} allowed)`
  if (!isHalfTimeBreak(s) && windowsLeft(s, side) <= 0 && queued(s, side).length === 0) return `no substitution windows left (${MAX_SUB_WINDOWS} allowed)`
  const off = s.players.find((p) => p.id === order.off)
  if (!off || off.side !== side || off.sentOff) return `${order.off} is not on the pitch for this team`
  if (subs.some((o) => o.off === order.off) || queued(s, side).some((q) => q.off === order.off)) return `${order.off} is already coming off`
  const on = availableBench(s, side).find((b) => b.id === order.on)
  if (!on || subs.some((o) => o.on === order.on)) return `${order.on} is not an available bench player`
  if ((on.role === "GK") !== (off.role === "GK")) return "only a goalkeeper can replace a goalkeeper"
  return null
}

/** The orders that can be applied, in order, and the ones dropped with the reason. */
export const checkOrders = (s: MatchState, side: Side, orders: ReadonlyArray<ManagerOrder>) => {
  const valid: ManagerOrder[] = []
  const dropped: Array<{ readonly order: ManagerOrder; readonly reason: string }> = []
  for (const order of orders) {
    const reason = orderProblem(s, side, order, valid)
    if (reason === null) valid.push(order)
    else dropped.push({ order, reason })
  }
  return { valid, dropped }
}

/** Apply orders for `side`: style changes at once, substitutions queued for the next tick. Throws OrderError. */
export const applyOrders = (s: MatchState, side: Side, orders: ReadonlyArray<ManagerOrder>): MatchState => {
  const { dropped } = checkOrders(s, side, orders)
  if (dropped.length > 0) throw new OrderError(dropped[0]!.reason)
  let style: Partial<TeamStyle> = {}
  const subs: SubOrder[] = [...queued(s, side)]
  for (const o of orders) {
    if (o.kind === "style") style = { ...style, [o.setting]: o.value }
    else subs.push({ off: o.off, on: o.on })
  }
  const team = s.config[side]
  const config = Object.keys(style).length > 0 ? { ...s.config, [side]: { ...team, style: { ...team.style, ...style } } } : s.config
  return subs.length > 0 ? { ...s, config, subOrders: { ...s.subOrders, [side]: subs } } : { ...s, config }
}
