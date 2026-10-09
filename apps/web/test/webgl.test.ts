import { describe, expect, it, vi } from "vitest"
import { hasWebGL } from "../src/view3d/webgl.js"

describe("the WebGL check", () => {
  it("probes once per page and gives the probe's context back, so it never eats into the browser's few live contexts", () => {
    const lose = vi.fn()
    const probe = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => ({ getExtension: () => ({ loseContext: lose }) })) as never)
    expect(hasWebGL()).toBe(true)
    expect(hasWebGL()).toBe(true)
    expect(probe).toHaveBeenCalledTimes(1)
    expect(lose).toHaveBeenCalledTimes(1)
    probe.mockRestore()
  })
})
