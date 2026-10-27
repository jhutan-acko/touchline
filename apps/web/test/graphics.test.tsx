import { act, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
import type { Cue } from "@touchline/schema"
import { App } from "../src/App.js"
import { Graphics } from "../src/Graphics.js"
import { fakeClient, INFO } from "./fake-client.js"

const segment = { mode: "casual", lang: "en", club: null } as const
const board: Cue = {
  cue_id: "m-board-120", schema: "touchline.cue/1", match_id: "m", moment_id: null, anchor: { frame_from: 120, frame_to: 120, clock: "12:00" },
  display: { slot: "top_bar", priority: 3, ttl_ms: 2000, template: "scoreboard" }, segment, text: null, data: { "score.home": 1, "score.away": 0 }, evidence: [], verified: true
}
const goal: Cue = {
  ...board, cue_id: "mo-1-casual.en.neutral", moment_id: "mo-1", display: { slot: "lower_third", priority: 1, ttl_ms: 12000, template: "goal" },
  text: { headline: "Wylford scores", body: "A crisp finish." }, data: {}
}

describe("graphics output", () => {
  it("shows the scoreboard and the cues sent to air over a transparent page, with no pitch and no buttons", () => {
    const client = fakeClient()
    render(<Graphics client={client} session="s1" segment={segment} match={INFO} />)
    expect(document.body.style.background).toBe("transparent")
    act(() => client.pushGraphics({ kind: "cue", cue: board }))
    act(() => client.pushGraphics({ kind: "cue", cue: goal }))
    expect(screen.getByTestId("score").textContent).toBe("1–0")
    expect(screen.getByText("Wylford scores")).toBeTruthy()
    expect(document.querySelector("canvas")).toBeNull()
    expect(screen.queryByRole("button")).toBeNull()
  })

  it("opens from a session in the fan app, for the viewer's segment", async () => {
    const client = fakeClient()
    render(<App client={client} />)
    await userEvent.click(await screen.findByRole("button", { name: "Watch" }))
    await userEvent.click(screen.getByRole("button", { name: "Broadcast tools" }))
    expect(screen.getByRole("link", { name: "Graphics output" }).getAttribute("href")).toBe("#/graphics/s1?seg=casual.en.neutral&match=lib-costly_error-1")
  })
})
