import { act, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import type { Cue } from "@touchline/schema"
import { App } from "../src/App.js"
import { Overlays } from "../src/Overlays.js"
import type { PitchFrame } from "@touchline/rpc"
import { EMPTY, reduce, type PaneState } from "../src/pane.js"
import { fakeClient } from "./fake-client.js"

const cue = (over: Partial<Cue> & { slot: Cue["display"]["slot"]; seg: Cue["segment"] }): Cue => ({
  cue_id: `c-${over.slot}-${over.seg.mode}.${over.seg.lang}`, schema: "touchline.cue/1", match_id: "m", moment_id: "mo-1",
  anchor: { frame_from: 100, frame_to: 120, clock: "12:00" }, display: { slot: over.slot, priority: 1, ttl_ms: 8000, template: "goal" },
  segment: over.seg, text: over.text ?? { headline: "Goal for Larkspur City!", body: "A clinical finish." },
  data: over.data ?? { "shot.xg": 0.068 }, evidence: ["m-e10", "shot.xg@m-e10"], verified: true
})
const FPS = 10
const frame = (n: number): PitchFrame => ({ frame: n, period: "first_half", clock: "10:00.00", ball: { x: 0, y: 0, z: 0 }, home: [], away: [] })
const frames = (s: PaneState, from: number, to: number) => {
  for (let n = from; n <= to; n++) s = reduce(s, { kind: "frame", frame: frame(n) }, FPS)
  return s
}

describe("overlays", () => {
  it("put casual cues in the lower third, analyst cues in the side panel, recaps on a card, each in its language", async () => {
    const onWhy = vi.fn()
    let s = reduce(EMPTY, { kind: "cue", cue: cue({ slot: "lower_third", seg: { mode: "casual", lang: "hi", club: null }, text: { headline: "लार्कस्पर सिटी का गोल!", body: "शानदार फिनिश।" } }) }, FPS)
    s = reduce(s, { kind: "cue", cue: cue({ slot: "side_panel", seg: { mode: "analyst", lang: "en", club: null } }) }, FPS)
    s = reduce(s, { kind: "cue", cue: cue({ slot: "recap_card", seg: { mode: "casual", lang: "en", club: null }, text: { headline: "Half-time: Northwick v Larkspur", body: "Score: 0-1." } }) }, FPS)
    const { container } = render(<Overlays state={s} frame={110} lang="en" onWhy={onWhy} />)
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

  it("shows a cue between its anchor and anchor+ttl in frames, whatever the wall clock", () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    try {
      // Arrives at frame 110 (before its anchor ends): on screen from frame 100 to 120 + 8 s × 10 fps = 200.
      let s = frames(EMPTY, 100, 110)
      s = reduce(s, { kind: "cue", cue: cue({ slot: "lower_third", seg: { mode: "casual", lang: "en", club: null } }) }, FPS)
      const shown = (f: number) => {
        const { container, unmount } = render(<Overlays state={s} frame={f} lang="en" />)
        const on = container.querySelector('[data-slot="lower_third"]') !== null
        unmount()
        return on
      }
      expect([shown(99), shown(100), shown(200), shown(201)]).toEqual([false, true, true, false])
      vi.setSystemTime(Date.now() + 3_600_000) // an hour later on the wall clock: no different
      expect([shown(99), shown(100), shown(200), shown(201)]).toEqual([false, true, true, false])
      // Arriving late (at frame 300, after its anchor), the ttl runs from the arrival instead.
      s = frames(s, 111, 300)
      s = reduce(s, { kind: "cue", cue: { ...cue({ slot: "lower_third", seg: { mode: "casual", lang: "en", club: null } }), cue_id: "late" } }, FPS)
      expect([shown(300), shown(380), shown(381)]).toEqual([true, true, false])
    } finally {
      vi.useRealTimers()
    }
  })

  it("keeps overlays as they were while frozen even as new cues arrive", async () => {
    const client = fakeClient()
    render(<App client={client} />)
    await userEvent.click(await screen.findByRole("button", { name: "Watch" }))
    const seg = { mode: "casual", lang: "en", club: null } as const
    for (let n = 100; n <= 150; n++) act(() => client.push({ kind: "frame", frame: frame(n) }))
    act(() => client.push({ kind: "cue", cue: cue({ slot: "lower_third", seg, text: { headline: "Before the pause", body: "." } }) }))
    await userEvent.click(screen.getByRole("button", { name: "Pause" }))
    for (let n = 151; n <= 180; n++) act(() => client.push({ kind: "frame", frame: frame(n) }))
    act(() => client.push({ kind: "cue", cue: { ...cue({ slot: "lower_third", seg, text: { headline: "After the pause", body: "." } }), cue_id: "after", anchor: { frame_from: 160, frame_to: 170, clock: "12:06" } } }))
    const lower = () => document.querySelector('[data-slot="lower_third"]')?.textContent ?? ""
    expect(lower()).toContain("Before the pause")
    expect(lower()).not.toContain("After the pause")
    await userEvent.click(screen.getByRole("button", { name: "Play" }))
    expect(lower()).toContain("After the pause")
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
    expect(document.querySelector('[data-slot="side_panel"]')!.textContent).toContain("Golpe para Northwick")
  })
})
