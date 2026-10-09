import { act, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PitchFrame } from "@touchline/rpc"
import type { Cue } from "@touchline/schema"
import { App } from "../src/App.js"
import type { Stage3DProps } from "../src/view3d/Stage3D.js"
import { hasWebGL } from "../src/view3d/webgl.js"
import { VIEW_KEY } from "../src/Watch.js"
import { fakeClient } from "./fake-client.js"

// jsdom has no WebGL: the stage is a stand-in that shows what it was asked to draw (the drawing is checked in the browser).
vi.mock("../src/view3d/webgl.js", () => ({ hasWebGL: vi.fn(() => true) }))
vi.mock("../src/view3d/Stage3D.js", () => ({
  Stage3D: (p: Stage3DProps) => (
    <div data-testid="stage" data-camera={p.camera} data-layout={p.layout} data-mode={p.mode} data-followed={p.followed ?? ""} data-rate={p.plays.real.rate()}>
      <button type="button" onClick={() => p.onPick?.("p-lar-09")}>pick the striker</button>
      <span data-testid="caption">{p.label({ key: "main", x: 0, y: 0, w: 100, h: 100, world: "real", camera: p.camera, inset: false })}</span>
    </div>
  )
}))

const frame = (n: number, ball: [number, number], away = true): PitchFrame => ({
  frame: n, period: "first_half", clock: "10:00.00", ball: { x: ball[0], y: ball[1], z: 0 },
  home: [{ id: "p-nor-01", x: -50, y: 0 }], away: away ? [{ id: "p-lar-09", x: 10, y: 0 }] : []
})
const goal: Cue = {
  cue_id: "mo-g1-casual.en.neutral", schema: "touchline.cue/1", match_id: "lib-costly_error-1", moment_id: "mo-g1",
  anchor: { frame_from: 0, frame_to: 0, clock: "32:14" }, display: { slot: "lower_third", priority: 1, ttl_ms: 12000, template: "goal" },
  segment: { mode: "casual", lang: "en", club: null }, text: { headline: "Wylford finishes in style!", body: "A crisp finish." }, data: {}, evidence: [], verified: true
}

const watch3d = async () => {
  const client = fakeClient()
  render(<App client={client} />)
  await userEvent.click(await screen.findByRole("button", { name: "Watch" }))
  await userEvent.click(screen.getByRole("button", { name: "3D" }))
  return client
}
const stage = () => screen.getByTestId("stage").dataset

beforeEach(() => {
  localStorage.clear()
  vi.mocked(hasWebGL).mockReturnValue(true)
})

describe("the 3D view", () => {
  it("replaces the 2D pitch, keeps the cue overlays on top, and is remembered for the next visit", async () => {
    const client = await watch3d()
    expect(screen.queryByRole("img", { name: /Northwick/ })).toBeNull()
    expect(stage().mode).toBe("multi")
    act(() => client.push({ kind: "cue", cue: goal }))
    expect(document.querySelector('[data-slot="lower_third"]')!.textContent).toMatch(/Wylford finishes in style!/)
    expect(localStorage.getItem(VIEW_KEY)).toBe("3d")
    await userEvent.click(screen.getByRole("button", { name: /Back to matches/ }))
    await userEvent.click(await screen.findByRole("button", { name: "Watch" }))
    expect(screen.getByTestId("stage")).toBeTruthy()
    await userEvent.click(screen.getByRole("button", { name: "2D" }))
    expect(screen.getByRole("img", { name: /Northwick/ })).toBeTruthy()
  })

  it("stays on the 2D pitch without WebGL, and says why", async () => {
    vi.mocked(hasWebGL).mockReturnValue(false)
    localStorage.setItem(VIEW_KEY, "3d")
    render(<App client={fakeClient()} />)
    await userEvent.click(await screen.findByRole("button", { name: "Watch" }))
    const button = screen.getByRole("button", { name: "3D" }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(button.title).toMatch(/WebGL/)
    expect(screen.getByRole("img", { name: /Northwick/ })).toBeTruthy()
  })

  it("follows the player nearest the ball at first, then whoever is clicked, chosen or stepped to", async () => {
    const client = await watch3d()
    act(() => client.push({ kind: "frame", frame: frame(1, [9, 0]) }))
    expect(stage().followed).toBe("p-lar-09")
    expect(screen.getByTestId("caption").textContent).toBe("Follow · #9 Feseo Wylford")
    await userEvent.keyboard("]")
    expect(stage().followed).toBe("p-nor-01")
    await userEvent.selectOptions(screen.getByLabelText("Following"), "p-lar-09")
    expect(stage().followed).toBe("p-lar-09")
    await userEvent.keyboard("[[") // a literal "["
    await userEvent.click(screen.getByRole("button", { name: "pick the striker" }))
    expect(stage().followed).toBe("p-lar-09")
  })

  it("switches camera and layout by buttons and keys 1–4", async () => {
    await watch3d()
    const cams = screen.getByRole("group", { name: "Camera" })
    await userEvent.click(within(cams).getByRole("button", { name: "Broadcast" }))
    expect(stage().camera).toBe("broadcast")
    expect(within(cams).getByRole("button", { name: "Broadcast" }).getAttribute("aria-pressed")).toBe("true")
    await userEvent.keyboard("2")
    expect(stage().camera).toBe("fp")
    await userEvent.keyboard("4")
    expect(stage().camera).toBe("tactical")
    await userEvent.click(within(screen.getByRole("group", { name: "Layout" })).getByRole("button", { name: "Grid 2×2" }))
    expect(stage().layout).toBe("grid")
  })

  it("hands over to the broadcast camera when the followed player leaves the pitch, and says so", async () => {
    const client = await watch3d()
    act(() => client.push({ kind: "frame", frame: frame(1, [9, 0]) }))
    act(() => client.push({ kind: "frame", frame: frame(2, [9, 0], false) }))
    expect(stage().camera).toBe("broadcast")
    expect(screen.getByRole("status").textContent).toMatch(/#9 Feseo Wylford left the pitch/)
  })

  it("animates the bodies at the session's speed, and not at all while it is paused, so feet do not slide", async () => {
    const client = await watch3d()
    act(() => client.push({ kind: "playback", playback: { state: "playing", frame: 1, speed: 4, live: false } }))
    expect(stage().rate).toBe("4")
    act(() => client.push({ kind: "playback", playback: { state: "paused", frame: 1, speed: 4, live: false } }))
    expect(stage().rate).toBe("0")
  })

  it("follows someone still on the pitch after the followed player leaves, and says so whatever the camera", async () => {
    const client = await watch3d()
    await userEvent.click(within(screen.getByRole("group", { name: "Layout" })).getByRole("button", { name: "Grid 2×2" }))
    await userEvent.click(within(screen.getByRole("group", { name: "Camera" })).getByRole("button", { name: "Tactical" }))
    act(() => client.push({ kind: "frame", frame: frame(1, [9, 0]) }))
    expect(stage().followed).toBe("p-lar-09")
    act(() => client.push({ kind: "frame", frame: frame(2, [9, 0], false) }))
    expect(screen.getByRole("status").textContent).toMatch(/#9 Feseo Wylford left the pitch/)
    expect(stage().camera).toBe("tactical")
    expect(stage().followed).toBe("p-nor-01")
    expect((screen.getByLabelText("Following") as HTMLSelectElement).value).toBe("p-nor-01")
  })

  it("shows both demo profiles in 3D", async () => {
    await watch3d()
    await userEvent.click(screen.getByRole("button", { name: "Split screen" }))
    expect(screen.getAllByTestId("stage")).toHaveLength(2)
  })
})
