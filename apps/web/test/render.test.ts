import { describe, expect, it, vi } from "vitest"
import { disposeChain } from "../src/view3d/render.js"

describe("a view's effects chain", () => {
  it("frees every pass's GPU targets with its own, not only the composer's (ambient occlusion and bloom hold several)", () => {
    const passes = [{ dispose: vi.fn() }, { dispose: vi.fn() }, {}]
    const composer = { passes, dispose: vi.fn() }
    disposeChain(composer)
    expect(composer.dispose).toHaveBeenCalledTimes(1)
    for (const p of passes.slice(0, 2)) expect(p.dispose).toHaveBeenCalledTimes(1)
    disposeChain(null)
  })
})
