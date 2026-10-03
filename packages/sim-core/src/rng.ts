/**
 * Deterministic, splittable PRNG for the simulator.
 *
 * sfc32 generator with a murmur3-finaliser seeder. State is a plain immutable
 * record so it can live inside MatchState; `Rng` is a small mutable cursor used
 * inside one step and written back afterwards.
 */
export interface RngState {
  readonly a: number
  readonly b: number
  readonly c: number
  readonly d: number
}

const fmix32 = (input: number): number => {
  let h = input >>> 0
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

const hashString = (s: string): number => {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

export const nextU32 = (s: RngState): readonly [number, RngState] => {
  let { a, b, c, d } = s
  let t = (a + b) >>> 0
  a = (b ^ (b >>> 9)) >>> 0
  b = (c + (c << 3)) >>> 0
  c = ((c << 21) | (c >>> 11)) >>> 0
  d = (d + 1) >>> 0
  t = (t + d) >>> 0
  c = (c + t) >>> 0
  return [t, { a, b, c, d }]
}

export const seedRng = (seed: number): RngState => {
  let s = seed >>> 0
  const next = () => {
    s = (s + 0x9e3779b9) >>> 0
    return fmix32(s)
  }
  let state: RngState = { a: next(), b: next(), c: next(), d: 1 }
  for (let i = 0; i < 12; i++) state = nextU32(state)[1]
  return state
}

/** Independent stream for one concern ("decision", "execution", ...). */
export const substream = (seed: number, concern: string, n = 0): RngState =>
  seedRng(fmix32((seed >>> 0) ^ hashString(concern) ^ Math.imul(n + 1, 0x27d4eb2d)))

export class Rng {
  #s: RngState
  constructor(state: RngState) {
    this.#s = state
  }
  get state(): RngState {
    return this.#s
  }
  u32(): number {
    const [v, next] = nextU32(this.#s)
    this.#s = next
    return v
  }
  /** Uniform in [0, 1). */
  uniform(): number {
    return this.u32() / 4294967296
  }
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.uniform()
  }
  chance(p: number): boolean {
    return this.uniform() < p
  }
  /** Standard normal via Box-Muller (one value per call, no caching, so draws stay countable). */
  normal(): number {
    const u = Math.max(this.uniform(), 1e-12)
    const v = this.uniform()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }
  /** Index drawn proportionally to non-negative weights; -1 if all weights are zero. */
  weighted(weights: ReadonlyArray<number>): number {
    let total = 0
    for (const w of weights) total += Math.max(0, w)
    if (total <= 0) return -1
    let r = this.uniform() * total
    for (let i = 0; i < weights.length; i++) {
      r -= Math.max(0, weights[i]!)
      if (r < 0) return i
    }
    return weights.length - 1
  }
}

/** Convert a per-second hazard rate into a per-tick probability (tick-length independent). */
export const hazard = (ratePerSecond: number, dtSeconds: number): number =>
  1 - Math.exp(-Math.max(0, ratePerSecond) * dtSeconds)
