import { act, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
import type { Cue, Segment } from "@touchline/schema"
import { App } from "../src/App.js"
import { fakeClient } from "./fake-client.js"

const variant = (segment: Segment, headline: string): Cue => ({
  cue_id: `mo-1-${segment.mode}.${segment.lang}`, schema: "touchline.cue/1", match_id: "m", moment_id: "mo-1",
  anchor: { frame_from: 100, frame_to: 120, clock: "12:00" }, display: { slot: segment.mode === "casual" ? "lower_third" : "side_panel", priority: 1, ttl_ms: 8000, template: "goal" },
  segment, text: { headline, body: "…" }, data: {}, evidence: [], verified: true
})

describe("split screen", () => {
  it("shows two profiles of the same session side by side, each with its own cues, and goes back to one", async () => {
    const client = fakeClient()
    render(<App client={client} />)
    await userEvent.click(await screen.findByRole("button", { name: "Watch" }))
    await userEvent.click(screen.getByRole("button", { name: "Broadcast tools" }))
    await userEvent.click(screen.getByRole("button", { name: "Split screen" }))
    const casual = { mode: "casual", lang: "en", club: null } as const
    const analyst = { mode: "analyst", lang: "es", club: null } as const
    expect(client.watchers.map((w) => w.segment)).toEqual([casual, analyst])
    // The session delivers each watcher its own segment's variant of the same moment.
    act(() => {
      client.watchers[0]!.onTick({ kind: "cue", cue: variant(casual, "Goal for Larkspur City!") })
      client.watchers[1]!.onTick({ kind: "cue", cue: variant(analyst, "Remate de 0,07 xG") })
    })
    const [a, b] = [screen.getByRole("region", { name: "A" }), screen.getByRole("region", { name: "B" })]
    expect(a.querySelector('[data-slot="lower_third"]')!.textContent).toContain("Goal for Larkspur City!")
    expect(b.querySelector('[data-slot="side_panel"]')!.textContent).toContain("Remate de 0,07 xG")
    expect(within(a).queryAllByText("Remate de 0,07 xG")).toEqual([])
    await userEvent.selectOptions(within(b).getByLabelText("B Idioma"), "hi")
    expect(client.watchers.map((w) => w.segment)).toEqual([casual, { ...analyst, lang: "hi" }])
    await userEvent.click(screen.getByRole("button", { name: "Broadcast tools" }))
    await userEvent.click(screen.getByRole("button", { name: "Single view" }))
    expect(client.watchers.map((w) => w.segment)).toEqual([casual])
  })
})
