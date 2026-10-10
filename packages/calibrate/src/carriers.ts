/**
 * Frozen ball carriers: stretches of play where the ball is in play and both it and the player nearest it stand still.
 * Line-for-line port of python/analytics/touchline_analytics/carriers.py (checked by the parity test); real values in
 * data/params/still-carriers.json. Real football has almost none away from keepers holding the ball.
 */
import type { Frame, Role } from "@touchline/sim-core"

export const HZ = 10
export const MIN_S = 1.5
export const BALL_STILL = 0.3
export const PLAYER_STILL = 0.5
export const NEAR_M = 1.5

export interface CarrierHalf {
  readonly ball: ReadonlyArray<readonly [number, number]>
  readonly live: ReadonlyArray<boolean>
  /** Positions by player at 10 Hz (null where the player is not on the pitch). */
  readonly players: ReadonlyMap<string, ReadonlyArray<readonly [number, number] | null>>
  readonly keepers: ReadonlySet<string>
}

export interface Stretches {
  readonly count: number
  readonly seconds: number
  readonly longest: number
}

export interface StillCarriers {
  readonly GK: Stretches
  readonly outfield: Stretches
}

/** Stretches of still ball and still carrier over the halves, for keepers and for outfielders. */
export const stillCarriers = (halves: ReadonlyArray<CarrierHalf>): StillCarriers => {
  const out = { GK: { count: 0, seconds: 0, longest: 0 }, outfield: { count: 0, seconds: 0, longest: 0 } }
  const close = (run: number, who: string | null, keepers: ReadonlySet<string>) => {
    if (run >= MIN_S * HZ && who !== null) {
      const k = out[keepers.has(who) ? "GK" : "outfield"]
      const s = run / HZ
      k.count += 1
      k.seconds += s
      k.longest = Math.max(k.longest, s)
    }
  }
  for (const h of halves) {
    const ids = [...h.players.keys()].sort()
    let run = 0
    let who: string | null = null
    for (let i = 0; i < h.ball.length; i++) {
      let ok = false
      let best: string | null = null
      if (i > 0 && h.live[i]) {
        const b = h.ball[i]!
        const a = h.ball[i - 1]!
        const bv = Math.hypot(b[0] - a[0], b[1] - a[1]) * HZ
        let nd = Infinity
        for (const id of ids) {
          const p = h.players.get(id)![i]
          if (!p) continue
          const d = Math.hypot(p[0] - b[0], p[1] - b[1])
          if (d < nd) {
            best = id
            nd = d
          }
        }
        if (best !== null && bv < BALL_STILL && nd < NEAR_M) {
          const q = h.players.get(best)![i - 1]
          const p = h.players.get(best)![i]!
          ok = q !== null && q !== undefined && Math.hypot(p[0] - q[0], p[1] - q[1]) * HZ < PLAYER_STILL
        }
      }
      if (ok) {
        run += 1
        who = best
      } else {
        close(run, who, h.keepers)
        run = 0
        who = null
      }
    }
    close(run, who, h.keepers)
  }
  const r4 = (v: number) => Math.round(v * 1e4) / 1e4
  return { GK: { ...out.GK, seconds: r4(out.GK.seconds) }, outfield: { ...out.outfield, seconds: r4(out.outfield.seconds) } }
}

/** A simulated match's halves (10 Hz frames) as the measure reads them; keepers by role. */
export const simCarrierHalves = (frames: ReadonlyArray<Frame>, roles: ReadonlyMap<string, Role>): CarrierHalf[] => {
  const ids = [...roles.keys()]
  const keepers = new Set(ids.filter((id) => roles.get(id) === "GK"))
  const out: Array<{ ball: Array<[number, number]>; live: boolean[]; players: Map<string, Array<[number, number] | null>> }> = []
  let period: string | null = null
  for (const f of frames) {
    if (f.period !== period) out.push({ ball: [], live: [], players: new Map(ids.map((id) => [id, []])) })
    period = f.period
    const h = out.at(-1)!
    h.ball.push([f.ball.x, f.ball.y])
    h.live.push(f.ball_in_play)
    const here = new Map([...f.home, ...f.away].map((p) => [p.id, [p.x, p.y] as [number, number]]))
    for (const id of ids) h.players.get(id)!.push(here.get(id) ?? null)
  }
  return out.map((h) => ({ ...h, players: new Map([...h.players].filter(([, xy]) => xy.some((p) => p !== null))), keepers }))
}
