import { act, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
import type { PitchFrame } from "@touchline/rpc"
import type { Cue } from "@touchline/schema"
import { App } from "../src/App.js"
import { fakeClient } from "./fake-client.js"

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
})
