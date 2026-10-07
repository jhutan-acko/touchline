import { act, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
import type { Cue } from "@touchline/schema"
import { App } from "../src/App.js"
import { fakeClient } from "./fake-client.js"

const board = (home: number, away: number, clock: string): Cue => ({
  cue_id: `b-${clock}`, schema: "touchline.cue/1", match_id: "m", moment_id: null, anchor: { frame_from: 0, frame_to: 0, clock },
  display: { slot: "top_bar", priority: 3, ttl_ms: 2000, template: "scoreboard" }, segment: { mode: "casual", lang: "en", club: null },
  text: null, data: { "score.home": home, "score.away": away, "team.mom.home": 0.62, "team.mom.away": 0.38 }, evidence: [], verified: true
})

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

  it("pauses, resumes and changes speed for the session, and goes back to the list", async () => {
    const client = fakeClient()
    render(<App client={client} />)
    await userEvent.click(await screen.findByRole("button", { name: "Watch" }))
    await userEvent.click(await screen.findByRole("button", { name: "Pause" }))
    await userEvent.click(await screen.findByRole("button", { name: "Play" }))
    await userEvent.selectOptions(screen.getByLabelText("Speed"), "16")
    expect(client.calls.slice(1)).toEqual(["control pause", "control play", "control speed 16"])
    act(() => client.push({ kind: "playback", playback: { state: "ended", frame: 58000, speed: 16, live: false } }))
    expect(screen.getByText("Full-time")).toBeTruthy()
    await userEvent.click(screen.getByRole("button", { name: /Back to matches/ }))
    expect(client.watchers).toEqual([])
    expect(await screen.findByRole("listitem")).toBeTruthy()
  })
})
