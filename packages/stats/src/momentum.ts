import { PITCH } from "@touchline/sim-core"

/** Momentum half-life (seconds). */
export const MOMENTUM_HALF_LIFE_S = 120
/** Contributions older than this are ignored (they weigh less than 1/1024). */
const MOMENTUM_HORIZON_S = 10 * MOMENTUM_HALF_LIFE_S

/** Attacking threat of a spot for a team attacking +x (`attack` = 1) or -x: 1 at the goal centre, falling with distance. */
export const threatAt = (x: number, y: number, attack: 1 | -1): number => Math.exp(-Math.hypot(attack * PITCH.halfL - x, y) / 20)

/**
 * Exponentially decayed attacking threat per team: what the engine adds (the gain in threatAt of completed passes
 * and carries, and weighted shot xG), each contribution halving in weight every two minutes.
 */
export class Momentum {
  private readonly contributions = new Map<string, Array<{ readonly tick: number; readonly value: number }>>()

  constructor(private readonly dt: number) {}

  add(team: string, tick: number, value: number): void {
    if (!(value > 0)) return
    let c = this.contributions.get(team)
    if (!c) this.contributions.set(team, (c = []))
    c.push({ tick, value })
  }

  /** Decayed threat of a team as of `at` (contributions stamped after `at` are not seen). */
  level(team: string, at: number): number {
    const c = this.contributions.get(team)
    if (!c) return 0
    const horizon = at - MOMENTUM_HORIZON_S / this.dt
    let sum = 0
    for (let i = c.length - 1; i >= 0; i--) {
      const x = c[i]!
      if (x.tick > at) continue
      if (x.tick < horizon) break
      sum += x.value * Math.pow(2, -((at - x.tick) * this.dt) / MOMENTUM_HALF_LIFE_S)
    }
    return sum
  }

  /** A team's share of both teams' decayed threat (null before either team has any). */
  share(team: string, opponent: string, at: number): number | null {
    const a = this.level(team, at)
    const b = this.level(opponent, at)
    return a + b > 1e-9 ? a / (a + b) : null
  }
}
