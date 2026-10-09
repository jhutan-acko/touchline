import { describe, expect, it } from "vitest"
import { advance, isSlow, LEAD_S, loopStart, SLOW } from "../src/view3d/clipclock.js"

const clip = { fps: 10, passIndex: 20, length: 100 }

describe("the what-if clock", () => {
  it("plays at the chosen speed, in slow motion for a second after the pass", () => {
    expect(advance(clip, 5, 0.1, 1)).toBeCloseTo(6)
    expect(advance(clip, 5, 0.1, 2)).toBeCloseTo(7)
    expect(isSlow(clip, 19.9)).toBe(false)
    expect(isSlow(clip, 20)).toBe(true)
    expect(advance(clip, 20, 0.1, 1)).toBeCloseTo(20 + SLOW)
    expect(isSlow(clip, 30)).toBe(false)
  })

  it("loops back to just before the pass at the end", () => {
    expect(loopStart(clip)).toBe(20 - LEAD_S * 10)
    expect(advance(clip, 98.95, 0.1, 1)).toBe(loopStart(clip))
    expect(loopStart({ fps: 10, passIndex: 5, length: 50 })).toBe(0)
  })
})
