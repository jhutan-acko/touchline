import { act, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import type { Cue } from "@touchline/schema"
import { App } from "../src/App.js"
import { Overlays } from "../src/Overlays.js"
import { EMPTY, reduce } from "../src/pane.js"
import { fakeClient } from "./fake-client.js"

const cue = (over: Partial<Cue> & { slot: Cue["display"]["slot"]; seg: Cue["segment"] }): Cue => ({
  cue_id: `c-${over.slot}-${over.seg.mode}.${over.seg.lang}`, schema: "touchline.cue/1", match_id: "m", moment_id: "mo-1",
  anchor: { frame_from: 100, frame_to: 120, clock: "12:00" }, display: { slot: over.slot, priority: 1, ttl_ms: 8000, template: "goal" },
  segment: over.seg, text: over.text ?? { headline: "Goal for Larkspur City!", body: "A clinical finish." },
  data: over.data ?? { "shot.xg": 0.068 }, evidence: ["m-e10", "shot.xg@m-e10"], verified: true
})

describe("overlays", () => {
  it("put casual cues in the lower third, analyst cues in the side panel, recaps on a card, each in its language", async () => {
    const onWhy = vi.fn()
    let s = reduce(EMPTY, { kind: "cue", cue: cue({ slot: "lower_third", seg: { mode: "casual", lang: "hi", club: null }, text: { headline: "लार्कस्पर सिटी का गोल!", body: "शानदार फिनिश।" } }) }, 0)
    s = reduce(s, { kind: "cue", cue: cue({ slot: "side_panel", seg: { mode: "analyst", lang: "en", club: null } }) }, 0)
    s = reduce(s, { kind: "cue", cue: cue({ slot: "recap_card", seg: { mode: "casual", lang: "en", club: null }, text: { headline: "Half-time: Northwick v Larkspur", body: "Score: 0-1." } }) }, 0)
    const { container } = render(<Overlays state={s} now={1000} lang="en" onWhy={onWhy} />)
    const lower = container.querySelector('[data-slot="lower_third"]')!
    expect(lower.getAttribute("lang")).toBe("hi")
    expect(lower.textContent).toContain("लार्कस्पर सिटी का गोल!")
    const side = container.querySelector('[data-slot="side_panel"]') as HTMLElement
    expect(within(side).getByText("shot.xg")).toBeTruthy()
    expect(within(side).getByText("0.068")).toBeTruthy()
    await userEvent.click(within(side).getByRole("button", { name: "Why?" }))
    expect(onWhy).toHaveBeenCalledWith(expect.objectContaining({ cue_id: "c-side_panel-analyst.en" }))
    expect(container.querySelector('[data-slot="recap_card"]')!.textContent).toContain("Half-time")
    expect(screen.getAllByTitle("Verified against the match data")).toHaveLength(3)
  })

  it("take a cue off the screen when its ttl runs out", () => {
    const s = reduce(EMPTY, { kind: "cue", cue: cue({ slot: "lower_third", seg: { mode: "casual", lang: "en", club: null } }) }, 0)
    const { container, rerender } = render(<Overlays state={s} now={7999} lang="en" />)
    expect(container.querySelector('[data-slot="lower_third"]')).not.toBeNull()
    rerender(<Overlays state={s} now={8000} lang="en" />)
    expect(container.querySelector('[data-slot="lower_third"]')).toBeNull()
  })
})

describe("profiles while watching", () => {
  it("re-watch the session for the new segment and switch the interface language", async () => {
    const client = fakeClient()
    render(<App client={client} />)
    await userEvent.click(await screen.findByRole("button", { name: "Watch" }))
    await userEvent.selectOptions(await screen.findByLabelText("Profile"), "analyst-es")
    expect(client.watchers.map((w) => w.segment)).toEqual([{ mode: "analyst", lang: "es", club: null }])
    expect(screen.getByRole("button", { name: "Pausa" })).toBeTruthy()
    await userEvent.selectOptions(screen.getByLabelText("Club"), "northwick")
    expect(client.watchers.map((w) => w.segment)).toEqual([{ mode: "analyst", lang: "es", club: "northwick" }])
    act(() => client.push({ kind: "cue", cue: cue({ slot: "side_panel", seg: { mode: "analyst", lang: "es", club: "northwick" }, text: { headline: "Golpe para Northwick", body: "Un remate certero." } }) }))
    expect(screen.getByText("Golpe para Northwick")).toBeTruthy()
  })
})
