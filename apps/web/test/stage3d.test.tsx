import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { Stage3D } from "../src/view3d/Stage3D.js"
import { INFO } from "./fake-client.js"

// jsdom has no ResizeObserver: a minimal one reporting a 800 × 450 box, so the canvas gets as far as starting WebGL.
class FakeResizeObserver {
  constructor(private readonly cb: (entries: unknown[]) => void) {}
  observe(el: Element) {
    this.cb([{ target: el, contentRect: { width: 800, height: 450, top: 0, left: 0, bottom: 450, right: 800, x: 0, y: 0 } }])
  }
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver
// ... and boxes with a size (React Three Fiber measures the canvas's box before it starts the renderer).
Element.prototype.getBoundingClientRect = () => ({ width: 800, height: 450, top: 0, left: 0, bottom: 450, right: 800, x: 0, y: 0, toJSON: () => ({}) })

describe("the 3D stage", () => {
  it("says the players could not load, instead of taking the page down, when WebGL cannot start (jsdom has none)", async () => {
    const play = { sample: () => null, kicks: () => [], rate: () => 1 }
    render(
      <main>
        <p>still here</p>
        <Stage3D match={INFO} plays={{ real: play }} mode="multi" layout="pip" camera="follow" followed={null} label={() => ""} loading="Loading players…" failed="Could not load the 3D players." />
      </main>
    )
    expect(await screen.findByText("Could not load the 3D players.")).toBeTruthy()
    expect(screen.getByText("still here")).toBeTruthy()
  })
})
