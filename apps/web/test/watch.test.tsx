import { act, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PitchFrame } from "@touchline/rpc"
import type { Cue } from "@touchline/schema"
import { App } from "../src/App.js"
import { parseMarker } from "../src/markers.js"
import type { Stage3DProps } from "../src/view3d/Stage3D.js"
import { fakeClient } from "./fake-client.js"

// jsdom has no WebGL: the 3D stage is a stand-in with a button per pitch marker (the 2D view needs none of this).
vi.mock("../src/view3d/webgl.js", () => ({ hasWebGL: () => true }))
vi.mock("../src/view3d/Stage3D.js", () => ({
  Stage3D: (p: Stage3DProps) => (
    <div data-testid="stage">
      {p.markers?.cues.map((c) => <button key={c.cue_id} type="button" onClick={() => p.markers!.onTap(parseMarker(c)!, c)}>{`tap ${c.display.template}`}</button>)}
    </div>
  )
}))
beforeEach(() => localStorage.clear())

const board = (home: number, away: number, clock: string): Cue => ({
  cue_id: `b-${clock}`, schema: "touchline.cue/1", match_id: "m", moment_id: null, anchor: { frame_from: 0, frame_to: 0, clock },
  display: { slot: "top_bar", priority: 3, ttl_ms: 2000, template: "scoreboard" }, segment: { mode: "casual", lang: "en", club: null },
  text: null, data: { "score.home": home, "score.away": away, "team.mom.home": 0.62, "team.mom.away": 0.38 }, evidence: [], verified: true
})

const frame = (n: number): PitchFrame => ({ frame: n, period: "first_half", clock: "10:00.00", ball: { x: 0, y: 0, z: 0 }, home: [], away: [] })
const shown = () => screen.getByRole("img", { name: "Northwick Mariners – Larkspur City" }).getAttribute("data-frame")
const watching = async () => {
  const client = fakeClient()
  render(<App client={client} />)
  await userEvent.click(await screen.findByRole("button", { name: "Watch" }))
  for (let n = 1; n <= 20; n++) act(() => client.push({ kind: "frame", frame: frame(n) }))
  return client
}

describe("watching a match", () => {
  it("starts a session with the chosen options and shows the scoreboard as it plays", async () => {
    const client = fakeClient()
    render(<App client={client} />)
    await userEvent.click(await screen.findByLabelText("Live agents"))
    await userEvent.clear(screen.getByLabelText("From minute"))
    await userEvent.type(screen.getByLabelText("From minute"), "60")
    await userEvent.click(screen.getByRole("button", { name: "Watch" }))
    expect(client.calls).toEqual(["start lib-costly_error-1 x4 live=true"])
    await screen.findByRole("img", { name: "Northwick Mariners – Larkspur City" })
    expect(client.watchers.map((w) => w.segment)).toEqual([{ mode: "casual", lang: "en", club: null }])
    act(() => client.push({ kind: "cue", cue: board(1, 0, "61:30") }))
    expect(screen.getByTestId("score").textContent).toBe("1–0")
    expect(screen.getByTestId("clock").textContent).toBe("61:30")
    expect(screen.getByTitle("Momentum").textContent).toBe("62%")
  })

  it("changes speed for the session, and goes back to the list", async () => {
    const client = fakeClient()
    render(<App client={client} />)
    await userEvent.click(await screen.findByRole("button", { name: "Watch" }))
    await userEvent.selectOptions(screen.getByLabelText("Speed"), "16")
    expect(client.calls.slice(1)).toEqual(["control speed 16"])
    act(() => client.push({ kind: "playback", playback: { state: "ended", frame: 58000, speed: 16, live: false } }))
    expect(screen.getByText("Full-time", { selector: "p" })).toBeTruthy()
    await userEvent.click(screen.getByRole("button", { name: /Back to matches/ }))
    expect(client.watchers).toEqual([])
    expect(await screen.findByRole("listitem")).toBeTruthy()
  })

  it("pause freezes only this viewer", async () => {
    const client = await watching()
    expect(shown()).toBe("20")
    await userEvent.click(screen.getByRole("button", { name: "Pause" }))
    for (let n = 21; n <= 40; n++) act(() => client.push({ kind: "frame", frame: frame(n) }))
    expect(shown()).toBe("20")
    expect(client.calls.filter((c) => c.startsWith("control"))).toEqual([])
    expect(client.watchers).toHaveLength(1) // still receiving the match
  })

  it("space toggles freeze", async () => {
    const client = await watching()
    await userEvent.keyboard(" ")
    expect(screen.getByRole("button", { name: "Play" })).toBeTruthy()
    act(() => client.push({ kind: "frame", frame: frame(21) }))
    expect(shown()).toBe("20")
    await userEvent.keyboard(" ")
    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy()
    expect(shown()).toBe("21")
    expect(client.calls.filter((c) => c.startsWith("control"))).toEqual([])
  })

  it("resume jumps to live", async () => {
    const client = await watching()
    await userEvent.click(screen.getByRole("button", { name: "Pause" }))
    for (let n = 21; n <= 90; n++) act(() => client.push({ kind: "frame", frame: frame(n) }))
    expect(shown()).toBe("20")
    await userEvent.click(screen.getByRole("button", { name: "Play" }))
    expect(shown()).toBe("90")
  })

  it("freeze opens Ask for the frozen frame", async () => {
    const client = await watching()
    expect(screen.queryByRole("region", { name: "Ask" })).toBeNull()
    await userEvent.click(screen.getByRole("button", { name: "Pause" }))
    expect(await screen.findByRole("region", { name: "Ask" })).toBeTruthy()
    expect(client.calls).toContain("suggest 20 en")
    await userEvent.type(screen.getByRole("textbox", { name: "Ask about this moment" }), "Who has the ball?{Enter}")
    expect(client.asks[0]!.req).toEqual({ frame: 20, question: "Who has the ball?", chip_id: null, segment: { mode: "casual", lang: "en", club: null } })
  })

  it("resume closes Ask", async () => {
    const client = await watching()
    await userEvent.click(screen.getByRole("button", { name: "Pause" }))
    await userEvent.type(await screen.findByRole("textbox", { name: "Ask about this moment" }), "Who has the ball?{Enter}")
    await userEvent.click(screen.getByRole("button", { name: "Play" }))
    expect(screen.queryByRole("region", { name: "Ask" })).toBeNull()
    expect(client.asks[0]!.stopped).toBe(true)
    expect(shown()).toBe("20")
  })

  it("tapping a marker opens Ask pre-filled", async () => {
    const client = fakeClient()
    render(<App client={client} />)
    await userEvent.click(await screen.findByRole("button", { name: "Watch" }))
    await userEvent.click(screen.getByRole("button", { name: "3D" }))
    for (let n = 1; n <= 20; n++) act(() => client.push({ kind: "frame", frame: frame(n) }))
    const ring: Cue = {
      cue_id: "ring-1", schema: "touchline.cue/1", match_id: "m", moment_id: null, anchor: { frame_from: 10, frame_to: 40, clock: "10:00" },
      display: { slot: "pitch_marker", priority: 1, ttl_ms: 4000, template: "pressure_ring" }, segment: { mode: "casual", lang: "en", club: null },
      text: null, data: { "at:p-lar-09": 1, count: 2 }, evidence: [], verified: true
    }
    act(() => client.push({ kind: "cue", cue: ring }))
    await userEvent.click(within(screen.getByTestId("stage")).getByRole("button", { name: "tap pressure_ring" }))
    expect(screen.getByRole("button", { name: "Play" })).toBeTruthy() // frozen
    const ask = await screen.findByRole("region", { name: "Ask" })
    expect((within(ask).getByRole("textbox", { name: "Ask about this moment" }) as HTMLInputElement).value).toBe("Who's pressing #9 Feseo Wylford?")
    expect(client.calls).toContain("suggest 20 en")
  })
  const textCue = (id: string, headline: string, template = "goal", evidence: string[] = []): Cue => ({
    cue_id: id, schema: "touchline.cue/1", match_id: "m", moment_id: id, anchor: { frame_from: 15, frame_to: 30, clock: "10:00" },
    display: { slot: "lower_third", priority: 2, ttl_ms: 8000, template }, segment: { mode: "casual", lang: "en", club: null },
    text: { headline, body: "." }, data: {}, evidence, verified: true
  })
  const pauseAndPlayOn = async (client: ReturnType<typeof fakeClient>) => {
    await userEvent.click(screen.getByRole("button", { name: "Pause" }))
    for (let n = 21; n <= 40; n++) act(() => client.push({ kind: "frame", frame: frame(n) }))
  }

  it("keeps the scoreboard as it was while frozen", async () => {
    const client = await watching()
    act(() => client.push({ kind: "cue", cue: board(1, 0, "10:00") }))
    await pauseAndPlayOn(client)
    act(() => client.push({ kind: "cue", cue: board(1, 1, "10:02") }))
    expect(screen.getByTestId("score").textContent).toBe("1–0")
    expect(screen.getByTestId("clock").textContent).toBe("10:00")
    await userEvent.click(screen.getByRole("button", { name: "Play" }))
    expect(screen.getByTestId("score").textContent).toBe("1–1")
  })

  it("keeps the feed and the overlays to what had arrived by the freeze, even for a cue anchored before it", async () => {
    const client = await watching()
    act(() => client.push({ kind: "cue", cue: textCue("c-before", "Before the pause") }))
    await pauseAndPlayOn(client)
    // Anchored 15..30, spanning the frozen frame 20, but arriving at 40.
    act(() => client.push({ kind: "cue", cue: textCue("c-after", "After the pause") }))
    const feed = () => screen.getByRole("list", { name: "feed" }).textContent
    expect(feed()).toContain("Before the pause")
    expect(feed()).not.toContain("After the pause")
    expect(document.querySelector('[data-slot="lower_third"]')?.textContent).toContain("Before the pause")
    await userEvent.click(screen.getByRole("button", { name: "Play" }))
    expect(feed()).toContain("After the pause")
    expect(document.querySelector('[data-slot="lower_third"]')?.textContent).toContain("After the pause")
  })

  it("does not pop up a better pass or a manager's decision while frozen", async () => {
    const client = await watching()
    await userEvent.click(screen.getByLabelText("Auto-show better passes"))
    await pauseAndPlayOn(client)
    act(() => client.push({ kind: "cue", cue: textCue("bp", "A better pass was on", "better_pass", ["e-1"]) }))
    act(() => client.push({ kind: "cue", cue: textCue("md", "Press higher", "manager_decision", ["decision-1-home"]) }))
    expect(client.calls.filter((c) => c.startsWith("whatIf") || c.startsWith("decisions"))).toEqual([])
    // Live again, they pop up as before.
    await userEvent.click(screen.getByRole("button", { name: "Play" }))
    act(() => client.push({ kind: "cue", cue: textCue("md2", "Press higher", "manager_decision", ["decision-2-home"]) }))
    act(() => client.push({ kind: "cue", cue: textCue("bp2", "A better pass was on", "better_pass", ["e-2"]) }))
    expect(client.calls.filter((c) => c.startsWith("whatIf") || c.startsWith("decisions"))).toEqual(["decisions s1", "whatIf e-2"])
  })

  it("does not draw a pitch marker that arrived after the freeze, until resumed", async () => {
    const client = fakeClient()
    render(<App client={client} />)
    await userEvent.click(await screen.findByRole("button", { name: "Watch" }))
    await userEvent.click(screen.getByRole("button", { name: "3D" }))
    for (let n = 1; n <= 20; n++) act(() => client.push({ kind: "frame", frame: frame(n) }))
    await pauseAndPlayOn(client)
    const ring: Cue = {
      cue_id: "ring-late", schema: "touchline.cue/1", match_id: "m", moment_id: null, anchor: { frame_from: 10, frame_to: 40, clock: "10:00" },
      display: { slot: "pitch_marker", priority: 1, ttl_ms: 4000, template: "pressure_ring" }, segment: { mode: "casual", lang: "en", club: null },
      text: null, data: { "at:p-lar-09": 1, count: 2 }, evidence: [], verified: true
    }
    act(() => client.push({ kind: "cue", cue: ring }))
    expect(within(screen.getByTestId("stage")).queryByRole("button", { name: "tap pressure_ring" })).toBeNull()
    await userEvent.click(screen.getByRole("button", { name: "Play" }))
    expect(within(screen.getByTestId("stage")).getByRole("button", { name: "tap pressure_ring" })).toBeTruthy()
  })

  it("reopens Ask after closing it while still frozen", async () => {
    await watching()
    await userEvent.click(screen.getByRole("button", { name: "Pause" }))
    const ask = await screen.findByRole("region", { name: "Ask" })
    await userEvent.click(within(ask).getByRole("button", { name: "Close" }))
    expect(screen.queryByRole("region", { name: "Ask" })).toBeNull()
    await userEvent.click(screen.getByRole("button", { name: "Ask" }))
    expect(await screen.findByRole("region", { name: "Ask" })).toBeTruthy()
    await userEvent.click(screen.getByRole("button", { name: "Play" }))
    expect(screen.queryByRole("button", { name: "Ask" })).toBeNull() // live: nothing to reopen
  })
})
