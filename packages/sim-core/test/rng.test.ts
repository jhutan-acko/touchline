import { describe, expect, it } from "vitest"
import { hazard, nextU32, Rng, seedRng, substream } from "../src/rng.js"

describe("rng", () => {
  it("is deterministic for a seed", () => {
    const a = new Rng(seedRng(42)), b = new Rng(seedRng(42))
    const xs = Array.from({ length: 5 }, () => a.u32()), ys = Array.from({ length: 5 }, () => b.u32())
    expect(xs).toEqual(ys)
  })
  it("matches pinned test vectors", () => {
    const r = new Rng(seedRng(1))
    expect(Array.from({ length: 3 }, () => r.u32())).toEqual(VECTORS_SEED_1)
  })
  it("gives independent substreams per concern", () => {
    const a = new Rng(substream(7, "decision")).u32(), b = new Rng(substream(7, "execution")).u32()
    expect(a).not.toEqual(b)
  })
  it("never mutates state passed in", () => {
    const s = seedRng(3)
    nextU32(s)
    expect(nextU32(s)[0]).toEqual(nextU32(s)[0])
  })
  it("uniform has mean ~0.5 and normal has sd ~1", () => {
    const r = new Rng(seedRng(9))
    let su = 0, sn = 0, sn2 = 0
    const n = 50000
    for (let i = 0; i < n; i++) { su += r.uniform(); const z = r.normal(); sn += z; sn2 += z * z }
    expect(su / n).toBeCloseTo(0.5, 2)
    expect(Math.sqrt(sn2 / n - (sn / n) ** 2)).toBeCloseTo(1, 1)
  })
  it("weighted respects zero weights", () => {
    const r = new Rng(seedRng(5))
    for (let i = 0; i < 200; i++) expect(r.weighted([0, 1, 0])).toBe(1)
    expect(r.weighted([0, 0])).toBe(-1)
  })
  it("hazard is tick-length independent over one second", () => {
    const perTick = (dt: number) => 1 - (1 - hazard(0.7, dt)) ** Math.round(1 / dt)
    expect(perTick(0.1)).toBeCloseTo(perTick(0.04), 10)
  })
})
const VECTORS_SEED_1 = [798213712, 3639092730, 3492534296]
