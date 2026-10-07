/**
 * Match statistics — a line-for-line port of python/analytics/touchline_analytics/metrics.py.
 * Real data is measured in Python; synthetic data is measured here during tuning. A parity test
 * runs both on the same synthetic match, so the two definitions cannot drift apart.
 */
import type { DomainEvent, Frame, Side } from "@touchline/sim-core"

export const LONG_PASS_M = 32
export const PASS_LEN_EDGES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 50, 60, 80, 120]
export const SPEED_EDGES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12]
const FULL_MATCH_SHARE = 0.95

export interface MatchMetrics extends Record<SpatialKey, number> {
  readonly passes: number
  readonly completion: number
  readonly long_share: number
  readonly pass_len_median: number
  readonly shots: number
  readonly on_target_share: number
  readonly blocked_share: number
  readonly save_rate: number
  readonly goals: number
  readonly penalties: number
  readonly corners: number
  readonly throw_ins: number
  readonly goal_kicks: number
  readonly free_kicks: number
  readonly fouls: number
  readonly cards: number
  readonly pass_len_hist: ReadonlyArray<number>
  readonly in_play_share: number
  readonly distance_km_median: number
  readonly peak_speed_kmh_median: number
  readonly speed_hist: ReadonlyArray<number>
}

export const SCALAR_KEYS = [
  "passes", "completion", "long_share", "pass_len_median", "shots", "on_target_share", "blocked_share", "save_rate", "goals", "penalties", "corners", "throw_ins",
  "goal_kicks", "free_kicks", "fouls", "cards", "in_play_share", "distance_km_median", "peak_speed_kmh_median"
] as const
export type ScalarKey = (typeof SCALAR_KEYS)[number]

/** Team shape and space (port of spatial_metrics in metrics.py; same order). */
export const SPATIAL_KEYS = ["width_poss_m", "width_def_m", "length_def_m", "line_height_def_m", "ball_pressure_m", "support_15m", "free_space_m"] as const
export type SpatialKey = (typeof SPATIAL_KEYS)[number]
export const SPATIAL_SAMPLE_S = 1
export const SUPPORT_RADIUS_M = 15

const hist = (values: ReadonlyArray<number>, edges: ReadonlyArray<number>): number[] => {
  const counts = new Array<number>(edges.length - 1).fill(0)
  for (const v of values)
    for (let i = 0; i < edges.length - 1; i++)
      if (edges[i]! <= v && v < edges[i + 1]!) {
        counts[i] = counts[i]! + 1
        break
      }
  const total = counts.reduce((a, b) => a + b, 0) || 1
  return counts.map((c) => c / total)
}

const median = (values: ReadonlyArray<number>): number => {
  const s = [...values].sort((a, b) => a - b)
  if (s.length === 0) return NaN
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

const SET_PIECE: Readonly<Record<string, string>> = { corner: "corner", throw_in: "throw_in", goal_kick: "goal_kick", free_kick: "free_kick", kickoff: "kick_off", penalty: "penalty" }

export const eventMetrics = (events: ReadonlyArray<DomainEvent>) => {
  const passes = events.filter((e) => e.type === "pass")
  const complete = passes.filter((e) => e.outcome === "successful")
  const lengths = complete.filter((e) => e.x_end !== null).map((e) => Math.hypot(e.x_end! - e.x!, e.y_end! - e.y!))
  const shots = events.filter((e) => e.type === "shot")
  const onTarget = shots.filter((e) => e.outcome === "goal" || e.outcome === "saved").length
  const sp = (k: string) => passes.filter((e) => SET_PIECE[String(e.attrs.restart ?? "")] === k).length
  return {
    passes: passes.length,
    completion: passes.length ? complete.length / passes.length : 0,
    long_share: lengths.length ? lengths.filter((v) => v >= LONG_PASS_M).length / lengths.length : 0,
    pass_len_median: median(lengths),
    shots: shots.length,
    on_target_share: shots.length ? onTarget / shots.length : 0,
    blocked_share: shots.length ? shots.filter((e) => e.outcome === "blocked").length / shots.length : 0,
    save_rate: onTarget ? shots.filter((e) => e.outcome === "saved").length / onTarget : 0,
    goals: shots.filter((e) => e.outcome === "goal").length,
    penalties: shots.filter((e) => e.attrs.technique === "penalty").length,
    corners: sp("corner"),
    throw_ins: sp("throw_in"),
    goal_kicks: sp("goal_kick"),
    free_kicks: sp("free_kick"),
    fouls: events.filter((e) => e.type === "foul").length,
    cards: events.filter((e) => e.type === "card").length,
    pass_len_hist: hist(lengths, PASS_LEN_EDGES)
  }
}

export const trackingMetrics = (frames: ReadonlyArray<Frame>, dt: number, smoothS = 0.2) => {
  let inPlay = 0
  const series = new Map<string, Array<[string, number, number, number]>>()
  const offset: Record<string, number> = { first_half: 0, second_half: 10_000 }
  for (const f of frames) {
    if (f.ball_in_play) inPlay++
    const t = offset[f.period]! + f.frame_id * dt
    for (const p of [...f.home, ...f.away]) {
      let s = series.get(p.id)
      if (!s) series.set(p.id, (s = []))
      s.push([f.period, t, p.x, p.y])
    }
  }
  const dists = new Map<string, number>()
  const peaks = new Map<string, number>()
  const speedsAll: number[] = []
  for (const [pid, pts] of series) {
    if (pts.length < 10) continue
    const step = (pts[pts.length - 1]![1] - pts[0]![1]) / Math.max(1, pts.length - 1)
    if (step <= 0) continue
    const w = Math.max(1, Math.round(smoothS / step))
    const half = Math.floor(w / 2)
    const avg = (arr: number[], i: number) => {
      const sl = arr.slice(Math.max(0, i - half), i + half + 1)
      let sum = 0
      for (const v of sl) sum += v
      return sum / sl.length
    }
    const xs = pts.map((p) => p[2])
    const ys = pts.map((p) => p[3])
    const sx = xs.map((_, i) => avg(xs, i))
    const sy = ys.map((_, i) => avg(ys, i))
    let d = 0
    const sp: number[] = []
    for (let i = 1; i < pts.length; i++) {
      if (pts[i]![0] !== pts[i - 1]![0] || pts[i]![1] - pts[i - 1]![1] > 2 * step + 1e-9) continue
      const st = Math.hypot(sx[i]! - sx[i - 1]!, sy[i]! - sy[i - 1]!)
      const v = st / (pts[i]![1] - pts[i - 1]![1])
      if (v > 12) continue
      d += st
      sp.push(v)
    }
    dists.set(pid, d)
    sp.sort((a, b) => a - b)
    peaks.set(pid, sp.length ? sp[Math.min(sp.length - 1, Math.floor(sp.length * 0.999))]! : 0)
    const stride = Math.max(1, Math.floor(sp.length / 2000))
    for (let i = 0; i < sp.length; i += stride) speedsAll.push(sp[i]!)
  }
  const counts = [...series].map(([pid, p]) => [pid, p.length] as const)
  const longest = counts.reduce((m, [, n]) => Math.max(m, n), 0)
  const full = counts.filter(([, n]) => n >= FULL_MATCH_SHARE * longest).map(([pid]) => pid)
  const fullD = full.filter((p) => dists.has(p)).map((p) => dists.get(p)!).sort((a, b) => a - b)
  const outfield = fullD.length > 4 ? fullD.slice(2) : fullD
  return {
    in_play_share: frames.length ? inPlay / frames.length : 0,
    distance_km_median: outfield.length ? median(outfield) / 1000 : NaN,
    peak_speed_kmh_median: median(full.filter((p) => peaks.has(p)).map((p) => peaks.get(p)! * 3.6)),
    speed_hist: hist(speedsAll, SPEED_EDGES)
  }
}

type Pt = readonly [number, number]

/**
 * Team shape and space, once a second, on live frames with a team in possession. Each team's attack
 * direction per period comes from its mean x in that period's first frame.
 */
export const spatialMetrics = (frames: ReadonlyArray<Frame>, dt: number, halfLength = 52.5): Record<SpatialKey, number> => {
  const offset: Record<string, number> = { first_half: 0, second_half: 10_000 }
  const dirs = new Map<string, Record<Side, number>>()
  const lastSec = new Map<string, number>()
  const wPoss: number[] = [], wDef: number[] = [], length: number[] = [], line: number[] = [], press: number[] = [], support: number[] = [], space: number[] = []
  const meanX = (pts: ReadonlyArray<Pt>) => pts.reduce((s, p) => s + p[0], 0) / pts.length
  const spreadY = (pts: ReadonlyArray<Pt>) => Math.max(...pts.map((p) => p[1])) - Math.min(...pts.map((p) => p[1]))
  const d = (p: Pt, q: Pt) => Math.hypot(p[0] - q[0], p[1] - q[1])
  for (const f of frames) {
    const teams: Record<Side, Pt[]> = { home: f.home.map((p) => [p.x, p.y] as const), away: f.away.map((p) => [p.x, p.y] as const) }
    if (!dirs.has(f.period) && teams.home.length && teams.away.length)
      dirs.set(f.period, { home: meanX(teams.home) < 0 ? 1 : -1, away: meanX(teams.away) < 0 ? 1 : -1 })
    const poss = f.possession_side
    const dir = dirs.get(f.period)
    if (!f.ball_in_play || poss === null || !dir) continue
    const sec = Math.floor((offset[f.period]! + f.frame_id * dt) / SPATIAL_SAMPLE_S + 1e-6)
    if (lastSec.get(f.period) === sec) continue
    lastSec.set(f.period, sec)
    const defSide: Side = poss === "home" ? "away" : "home"
    const att = teams[poss], def = teams[defSide]
    if (att.length < 3 || def.length < 3) continue
    wPoss.push(spreadY(att))
    wDef.push(spreadY(def))
    const u = def.map((p) => dir[defSide] * p[0]).sort((a, b) => a - b)
    length.push(u[u.length - 1]! - u[1]!)
    line.push(u[1]! + halfLength)
    const ball: Pt = [f.ball.x, f.ball.y]
    press.push(Math.min(...def.map((p) => d(p, ball))))
    support.push(Math.max(0, att.filter((p) => d(p, ball) <= SUPPORT_RADIUS_M).length - 1))
    let carrier = 0
    for (let i = 1; i < att.length; i++) if (d(att[i]!, ball) < d(att[carrier]!, ball)) carrier = i
    space.push(median(att.filter((_, i) => i !== carrier).map((p) => Math.min(...def.map((q) => d(p, q))))))
  }
  return {
    width_poss_m: median(wPoss),
    width_def_m: median(wDef),
    length_def_m: median(length),
    line_height_def_m: median(line),
    ball_pressure_m: median(press),
    support_15m: support.length ? support.reduce((a, b) => a + b, 0) / support.length : NaN,
    free_space_m: median(space)
  }
}

export const matchMetrics = (events: ReadonlyArray<DomainEvent>, frames: ReadonlyArray<Frame>, dt: number): MatchMetrics => ({
  ...eventMetrics(events),
  ...trackingMetrics(frames, dt),
  ...spatialMetrics(frames, dt)
})
