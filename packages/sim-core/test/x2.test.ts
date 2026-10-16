import { describe, expect, it } from "vitest"
import { DEFAULT_PARAMS as P, type Params } from "../src/params.js"
import { executeKick } from "../src/execute.js"
import type { PassHeight } from "../src/classify.js"
import { Rng, seedRng } from "../src/rng.js"

const off: Params = { ...P, pass: { ...P.pass, longErrorPerM: 0 } }
const on: Params = { ...P, pass: { ...P.pass, longErrorPerM: 0.03 } }

const meanError = (p: Params, length: number, height: PassHeight, errorScale?: number) => {
  const r = new Rng(seedRng(4))
  let err = 0
  for (let i = 0; i < 3000; i++) err += executeKick({ from: { x: 0, y: 0 }, to: { x: length, y: 0 }, height, technique: 0.6, composure: 0.6, pressure: 0, weakFoot: false, ...(errorScale === undefined ? {} : { errorScale }) }, p, r).errorM / 3000
  return err
}

describe("X2: long-pass error", () => {
  it("grows for high balls beyond 30 m, by 1 + longErrorPerM per metre", () => {
    const ratio = meanError(on, 45, "high") / meanError(off, 45, "high")
    expect(ratio).toBeGreaterThan(1.3)
    expect(ratio).toBeLessThan(1.6)
  })
  it("leaves short high balls and ground passes alone, and is exact when off", () => {
    expect(meanError(on, 20, "high")).toBe(meanError(off, 20, "high"))
    expect(meanError(on, 45, "ground")).toBe(meanError(off, 45, "ground"))
  })
  it("composes multiplicatively with errorScale", () => {
    const base = meanError(off, 45, "high")
    const both = meanError(on, 45, "high", 0.5)
    const scaledOnly = meanError(off, 45, "high", 0.5)
    expect(scaledOnly / base).toBeGreaterThan(0.4)
    expect(scaledOnly / base).toBeLessThan(0.6)
    expect(both / scaledOnly).toBeGreaterThan(1.3)
    expect(both / scaledOnly).toBeLessThan(1.6)
  })
})
