/**
 * Player movement statistics for the physics gate — a line-for-line port of the player half of
 * python/analytics/touchline_analytics/physics/validate.py (a parity test runs both on the same tracks).
 *
 * Tracks at 10 Hz; speed is the central difference |p[i+1] - p[i-1]| / 0.2 s, only where p[i-1], p[i] and p[i+1] are all
 * present; the change of speed is the central difference of speed averaged over five samples. Per frame by position
 * group: speed and change of speed. Per player with 30 minutes or more: maximum speed, metres per 90 minutes above
 * 20 and 25 km/h, and accelerations and decelerations past 3 m/s^2 per 90 minutes. Each statistic is a histogram on
 * fixed edges; W1 between two histograms is the area between their CDFs. The simulation passes a statistic when its
 * W1 to the real matches is within the largest W1 between two real matches (data/params/physics.json).
 */
import { GROUP_OF, type Frame, type Group, type MatchConfig, type Role } from "@touchline/sim-core"

export const GROUPS: ReadonlyArray<Group> = ["GK", "DEF", "MID", "FWD"]
const DT = 0.1
const MIN_MINUTES = 30
const HSR20 = 20 / 3.6
const HSR25 = 25 / 3.6
const EFFORT = 3

const edges = (lo: number, hi: number, step: number): number[] =>
  Array.from({ length: Math.round((hi - lo) / step) + 1 }, (_, i) => Math.round((lo + i * step) * 1e6) / 1e6)

export const PLAYER_EDGES: Readonly<Record<string, ReadonlyArray<number>>> = {
  ...Object.fromEntries(GROUPS.map((g) => [`speed_${g}`, edges(0, 11, 0.5)])),
  ...Object.fromEntries(GROUPS.map((g) => [`accel_${g}`, edges(-6, 6, 0.5)])),
  max_speed: edges(5, 11, 0.25),
  hsr20: edges(0, 1500, 50),
  hsr25: edges(0, 600, 25),
  acc_count: edges(0, 200, 5),
  dec_count: edges(0, 200, 5)
}

export type Point = readonly [number, number] | null
export type Tracks = ReadonlyMap<string, { readonly group: Group; readonly xy: ReadonlyArray<Point> }>

/** Values outside the edges go in the end bins; shares sum to 1 (all zero without values). */
export const hist = (values: ReadonlyArray<number>, e: ReadonlyArray<number>): number[] => {
  const counts = new Array<number>(e.length - 1).fill(0)
  const last = e[e.length - 1]!
  let n = 0
  for (const raw of values) {
    if (!Number.isFinite(raw)) continue
    const v = Math.min(Math.max(raw, e[0]!), last - 1e-9)
    for (let i = 0; i < e.length - 1; i++)
      if (v < e[i + 1]!) {
        counts[i] = counts[i]! + 1
        break
      }
    n++
  }
  return counts.map((c) => (n ? c / n : 0))
}

/** Wasserstein-1 between two histograms on the same edges, as masses at bin centres. */
export const w1 = (a: ReadonlyArray<number>, b: ReadonlyArray<number>, e: ReadonlyArray<number>): number => {
  let total = 0
  let fa = 0
  let fb = 0
  for (let i = 0; i < e.length - 2; i++) {
    fa += a[i]!
    fb += b[i]!
    total += Math.abs(fa - fb) * ((e[i + 2]! - e[i]!) / 2)
  }
  return total
}

const central = (x: ReadonlyArray<number>): number[] => {
  const out = new Array<number>(x.length).fill(NaN)
  for (let i = 1; i < x.length - 1; i++) if (Number.isFinite(x[i]!)) out[i] = (x[i + 1]! - x[i - 1]!) / (2 * DT)
  return out
}

const mean5 = (x: ReadonlyArray<number>): number[] => {
  const out = new Array<number>(x.length).fill(NaN)
  for (let i = 2; i < x.length - 2; i++) out[i] = (x[i - 2]! + x[i - 1]! + x[i]! + x[i + 1]! + x[i + 2]!) / 5
  return out
}

/** Raw samples of every player statistic. */
export const playerSamples = (tracks: Tracks): Record<string, number[]> => {
  const out: Record<string, number[]> = Object.fromEntries(Object.keys(PLAYER_EDGES).map((k) => [k, []]))
  for (const { group, xy } of tracks.values()) {
    const vx = central(xy.map((p) => (p ? p[0] : NaN)))
    const vy = central(xy.map((p) => (p ? p[1] : NaN)))
    const speed = vx.map((x, i) => Math.hypot(x, vy[i]!))
    const dspeed = central(mean5(speed))
    for (const v of speed) if (Number.isFinite(v)) out[`speed_${group}`]!.push(v)
    for (const v of dspeed) if (Number.isFinite(v)) out[`accel_${group}`]!.push(v)
    const minutes = (xy.filter((p) => p !== null).length * DT) / 60
    if (minutes < MIN_MINUTES) continue
    const per90 = 90 / minutes
    let max = -Infinity
    let h20 = 0
    let h25 = 0
    for (const v of speed) {
      if (!Number.isFinite(v)) continue
      if (v > max) max = v
      if (v > HSR20) h20 += v
      if (v > HSR25) h25 += v
    }
    out.max_speed!.push(max)
    out.hsr20!.push(h20 * DT * per90)
    out.hsr25!.push(h25 * DT * per90)
    const d = dspeed.map((v) => (Number.isFinite(v) ? v : 0))
    let acc = 0
    let dec = 0
    for (let i = 1; i < d.length; i++) {
      if (d[i]! > EFFORT && d[i - 1]! <= EFFORT) acc++
      if (d[i]! < -EFFORT && d[i - 1]! >= -EFFORT) dec++
    }
    out.acc_count!.push(acc * per90)
    out.dec_count!.push(dec * per90)
  }
  return out
}

export const playerMetrics = (tracks: Tracks): Record<string, number[]> => {
  const s = playerSamples(tracks)
  return Object.fromEntries(Object.entries(PLAYER_EDGES).map(([k, e]) => [k, hist(s[k]!, e)]))
}

/** Every player's role, starters and bench of both teams. */
export const rolesOf = (cfg: MatchConfig): Map<string, Role> =>
  new Map([cfg.home, cfg.away].flatMap((t) => [...t.starters, ...(t.bench ?? [])].map((p) => [p.id, p.role] as const)))

/** Every player's track in a simulated match (10 Hz frames), with a missing sample between the halves. */
export const simTracks = (frames: ReadonlyArray<Frame>, roles: ReadonlyMap<string, Role>): Tracks => {
  const ids = [...roles.keys()]
  const xy = new Map<string, Point[]>(ids.map((id) => [id, []]))
  let period: string | null = null
  for (const f of frames) {
    if (period !== null && f.period !== period) for (const id of ids) xy.get(id)!.push(null)
    period = f.period
    const here = new Map<string, Point>([...f.home, ...f.away].map((p) => [p.id, [p.x, p.y] as const]))
    for (const id of ids) xy.get(id)!.push(here.get(id) ?? null)
  }
  return new Map(ids.filter((id) => xy.get(id)!.some((p) => p !== null)).map((id) => [id, { group: GROUP_OF[roles.get(id)!], xy: xy.get(id)! }]))
}

export interface PhysicsFile {
  readonly validation: {
    readonly envelope: Readonly<Record<string, { readonly max: number }>>
    readonly real: { readonly players: Readonly<Record<string, ReadonlyArray<number>>> }
  }
}

export interface GateRow {
  readonly key: string
  readonly w1: number
  readonly max: number
  readonly pass: boolean
}

/** Each player statistic of the simulation against the real matches: W1 within the real inter-match envelope. */
export const physicsGate = (sim: Readonly<Record<string, ReadonlyArray<number>>>, physics: PhysicsFile): GateRow[] =>
  Object.entries(PLAYER_EDGES)
    .filter(([k]) => physics.validation.envelope[k] !== undefined && physics.validation.real.players[k] !== undefined)
    .map(([k, e]) => {
      const d = w1(sim[k]!, physics.validation.real.players[k]!, e)
      const max = physics.validation.envelope[k]!.max
      return { key: k, w1: d, max, pass: d <= max }
    })
