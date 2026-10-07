import { act, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
import type { Evidence } from "@touchline/rpc"
import type { Cue, Recap } from "@touchline/schema"
import { App } from "../src/App.js"
import { linePath } from "../src/Sparkline.js"
import { fakeClient } from "./fake-client.js"

const goal: Cue = {
  cue_id: "mo-g1-casual.en.neutral", schema: "touchline.cue/1", match_id: "lib-costly_error-1", moment_id: "mo-g1",
  anchor: { frame_from: 19280, frame_to: 19344, clock: "32:14" }, display: { slot: "lower_third", priority: 1, ttl_ms: 12000, template: "goal" },
  segment: { mode: "casual", lang: "en", club: null }, text: { headline: "Wylford finishes in style!", body: "A crisp left-footed finish." },
  data: { "shot.xg": 0.068 }, evidence: ["e1442"], verified: true
}
const evidence: Evidence = {
  cue_id: goal.cue_id, moment: null, cause: "unpressured combination and clean finishing", explanation: "Carreda and Wylford exchanged short passes without pressure.",
  claims: [{ kind: "metric", quote: "6.8%", label: "Expected goals", metric_id: "shot.xg", subject: null, subject_name: null, value: 0.0678, at_frame: 19344, event_id: "e1442" }],
  series: [{ metric_id: "team.mom", subject: "larkspur", label: "Momentum — Larkspur City", points: [{ frame: 16344, value: 0.4 }, { frame: 17844, value: null }, { frame: 19344, value: 0.62 }] }],
  events: [{ id: "e1442", type: "shot", clock: "32:13.70", team_id: "larkspur", player: "Feseo Wylford", outcome: "goal", qualifiers: { body_part: "left_foot" } }],
  model: "openai:gpt-6.1-sol"
}

describe("sparkline", () => {
  it("draws through the values, breaking at gaps, scaled to their range", () => {
    expect(linePath([{ frame: 0, value: 0 }, { frame: 1, value: 1 }], 100, 10)).toBe("M0,10 L100,0")
    expect(linePath([{ frame: 0, value: 0.4 }, { frame: 1, value: null }, { frame: 2, value: 0.62 }], 100, 10)).toBe("M0,10 M100,0")
    expect(linePath([{ frame: 0, value: null }], 100, 10)).toBe("")
  })
})

describe("Why? drawer", () => {
  it("opens from a cue on screen with the cause, checked facts, history and events, then closes", async () => {
    const client = fakeClient({ evidence })
    render(<App client={client} />)
    await userEvent.click(await screen.findByRole("button", { name: "Watch" }))
    act(() => client.push({ kind: "cue", cue: goal }))
    const lower = document.querySelector('[data-slot="lower_third"]') as HTMLElement
    await userEvent.click(within(lower).getByRole("button", { name: "Why?" }))
    const drawer = await screen.findByRole("dialog", { name: "Why?" })
    expect(await within(drawer).findByText("unpressured combination and clean finishing")).toBeTruthy()
    expect(within(drawer).getByText("Expected goals")).toBeTruthy()
    expect(within(drawer).getByText("6.8% ✓")).toBeTruthy()
    expect(within(drawer).getByRole("img", { name: "Momentum — Larkspur City" })).toBeTruthy()
    expect(within(drawer).getByText(/shot · Feseo Wylford · goal/)).toBeTruthy()
    expect(within(drawer).getByText(/openai:gpt-6.1-sol/)).toBeTruthy()
    expect(client.calls).toContain(`evidence ${goal.cue_id}`)
    await userEvent.click(within(drawer).getByRole("button", { name: "Close" }))
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("also opens from the feed after the cue has left the screen, and says when there is nothing behind it", async () => {
    const client = fakeClient()
    render(<App client={client} />)
    await userEvent.click(await screen.findByRole("button", { name: "Watch" }))
    act(() => client.push({ kind: "cue", cue: { ...goal, display: { ...goal.display, ttl_ms: 1 } } }))
    const feed = await screen.findByRole("list", { name: "feed" })
    await userEvent.click(within(feed).getByRole("button", { name: "Why?" }))
    const drawer = await screen.findByRole("dialog")
    expect(await within(drawer).findByText("—")).toBeTruthy()
  })
})

describe("recaps", () => {
  it("show the half-time recap and its card for the viewer's segment", async () => {
    const recap: Recap = { recap_id: "r-ht", match_id: "m", kind: "half_time", at_frame: 27000, sentences: ["Half-time: Northwick Mariners 0-1 Larkspur City", "Possession: Northwick Mariners 46%, Larkspur City 54%."], claims: [], turning_points: [], player_of_match: null, verified: true }
    const client = fakeClient({ recap: { recap, cards: [{ ...goal, cue_id: "r-ht-card", moment_id: "r-ht", display: { ...goal.display, slot: "recap_card" }, text: { headline: "Half-time: Northwick v Larkspur", body: "Score: 0-1." } }] } })
    render(<App client={client} />)
    await userEvent.click(await screen.findByRole("button", { name: "Watch" }))
    await userEvent.click(screen.getByRole("button", { name: "Half-time" }))
    expect(await screen.findByText("Half-time: Northwick v Larkspur — Score: 0-1.")).toBeTruthy()
    expect(screen.getByText("Possession: Northwick Mariners 46%, Larkspur City 54%.")).toBeTruthy()
  })
})
