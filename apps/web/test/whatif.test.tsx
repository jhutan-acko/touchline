import { act, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Evidence, PitchFrame, WhatIfClip } from "@touchline/rpc"
import type { Cue } from "@touchline/schema"
import { App } from "../src/App.js"
import { VIEW_KEY } from "../src/Watch.js"
import type { Stage3DProps } from "../src/view3d/Stage3D.js"
import { fakeClient } from "./fake-client.js"

// jsdom has no WebGL: the stage is a stand-in showing what it was asked to draw.
vi.mock("../src/view3d/webgl.js", () => ({ hasWebGL: () => true }))
vi.mock("../src/view3d/Stage3D.js", () => ({
  Stage3D: (p: Stage3DProps) => (
    <div data-testid="stage" data-mode={p.mode} data-camera={p.camera} data-followed={p.followed ?? ""}>
      {p.mode === "split" && ["real", "variant"].map((world) => <span key={world}>{p.label({ key: world, x: 0, y: 0, w: 1, h: 1, world: world as "real", camera: p.camera, inset: false })}</span>)}
    </div>
  )
}))

const frame = (n: number): PitchFrame => ({ frame: n, period: "first_half", clock: "16:30.00", ball: { x: 0, y: 0, z: 0 }, home: [{ id: "p-nor-01", x: 0, y: 0 }], away: [{ id: "p-lar-09", x: 5, y: 0 }] })
const clip: WhatIfClip = {
  event_id: "e679", verdict: "better_option_found", passer_id: "p-nor-01", played_to: "p-lar-09", better_to: "p-nor-01", fps: 10, pass_index: 20,
  real: Array.from({ length: 100 }, (_, i) => frame(9880 + i)), variant: Array.from({ length: 100 }, (_, i) => frame(9880 + i)),
  seeds: 20, horizon_s: 10, typical_seed: 8, shots: { played: 1, better: 6 }, goals: { played: 0, better: 2 }, gain: { mean: 0.2, se: 0.05 }
}
const better: Cue = {
  cue_id: "better-e679-casual.en.neutral", schema: "touchline.cue/1", match_id: "lib-costly_error-1", moment_id: "better-e679",
  anchor: { frame_from: 9900, frame_to: 9979, clock: "16:30" }, display: { slot: "lower_third", priority: 2, ttl_ms: 10000, template: "better_pass" },
  segment: { mode: "casual", lang: "en", club: null }, text: { headline: "A better pass was on", body: "#1 Datan Drenussen played it to #9 Feseo Wylford; …" },
  data: { "whatif.seeds": 20 }, evidence: ["e679"], verified: true
}
const evidence = (verdict: WhatIfClip["verdict"] | null): Evidence => ({
  cue_id: better.cue_id, moment: null, cause: "A better pass was on", explanation: null, claims: [], series: [], events: [], model: null, what_if: { event_id: "e679", verdict }
})

const open = async (o: Parameters<typeof fakeClient>[0]) => {
  const client = fakeClient(o)
  render(<App client={client} />)
  await userEvent.click(await screen.findByRole("button", { name: "Watch" }))
  act(() => client.push({ kind: "cue", cue: better }))
  await userEvent.click(within(document.querySelector('[data-slot="lower_third"]') as HTMLElement).getByRole("button", { name: "Why?" }))
  return client
}

// The live match is checked on the 2D pitch: with WebGL (mocked on) the page now opens in 3D unless the viewer saved 2D.
beforeEach(() => {
  localStorage.clear()
  localStorage.setItem(VIEW_KEY, "2d")
})

describe("the what-if split", () => {
  it("opens from a better pass's Why? drawer: both plays on one camera, the passer followed, the verified numbers, then back to live", async () => {
    const client = await open({ evidence: evidence("better_option_found"), whatIf: async () => clip })
    await userEvent.click(await screen.findByRole("button", { name: "Show me" }))
    expect(screen.queryByRole("dialog")).toBeNull()
    const split = await screen.findByRole("region", { name: "What if" })
    const stage = within(split).getByTestId("stage")
    expect(stage.dataset).toMatchObject({ mode: "split", camera: "follow", followed: "p-nor-01" })
    expect(within(split).getByText("What happened · pass to #9 Feseo Wylford")).toBeTruthy()
    expect(within(split).getByText("What if · pass to #1 Datan Drenussen")).toBeTruthy()
    const strip = within(split).getByTestId("evidence-strip")
    expect(strip.textContent).toMatch(/6 \/ 20 vs 1 \/ 20/)
    expect(strip.textContent).toMatch(/Goals: 2 vs 0/)
    expect(strip.textContent).toMatch(/\+0\.20 ± 0\.05/)
    expect(strip.textContent).toMatch(/re-run #8/)
    await userEvent.click(within(split).getByRole("button", { name: "Broadcast" }))
    expect(within(split).getByTestId("stage").dataset.camera).toBe("broadcast")
    expect(client.calls).toContain("whatIf e679")
    // The live match kept coming while the split was open.
    expect(client.watchers).toHaveLength(1)
    await userEvent.click(within(split).getByRole("button", { name: "Back to live" }))
    expect(screen.queryByRole("region", { name: "What if" })).toBeNull()
    expect(screen.getByRole("img", { name: /Northwick/ })).toBeTruthy()
  })

  it("offers it while the verdict is not known yet, and says honestly when re-simulation finds no better pass", async () => {
    await open({ evidence: evidence(null), whatIf: async () => ({ ...clip, verdict: "played_pass_was_best", better_to: null, variant: null }) })
    await userEvent.click(await screen.findByRole("button", { name: "Show me" }))
    expect(await screen.findByText("Re-simulation says the pass played was the best option")).toBeTruthy()
    expect(screen.queryByTestId("evidence-strip")).toBeNull()
  })

  it("is not offered when the verdict already says the pass played was best", async () => {
    await open({ evidence: evidence("played_pass_was_best") })
    const drawer = await screen.findByRole("dialog")
    expect(await within(drawer).findByText("Re-simulation says the pass played was the best option")).toBeTruthy()
    expect(within(drawer).queryByRole("button", { name: "Show me" })).toBeNull()
  })

  it("says it is re-simulating when the answer takes a while, and when it fails", async () => {
    let fail: (e: Error) => void = () => {}
    await open({ evidence: evidence(null), whatIf: () => new Promise((_, reject) => (fail = reject)) })
    await userEvent.click(await screen.findByRole("button", { name: "Show me" }))
    expect(await screen.findByText("Re-simulating 20 futures…", {}, { timeout: 2000 })).toBeTruthy()
    act(() => fail(new Error("WhatIfNotAvailable: timed out")))
    expect(await screen.findByText("Couldn't re-simulate this moment")).toBeTruthy()
  })

  it("opens by itself on a better pass when auto-show is on (the demo)", async () => {
    const client = fakeClient({ whatIf: async () => clip })
    render(<App client={client} />)
    await userEvent.click(await screen.findByRole("button", { name: "Watch" }))
    act(() => client.push({ kind: "cue", cue: { ...better, cue_id: "x", moment_id: "better-x" } }))
    expect(screen.queryByRole("region", { name: "What if" })).toBeNull()
    await userEvent.click(screen.getByRole("button", { name: "Broadcast tools" }))
    await userEvent.click(screen.getByLabelText("Auto-show better passes"))
    act(() => client.push({ kind: "cue", cue: better }))
    expect(await screen.findByRole("region", { name: "What if" })).toBeTruthy()
  })
})
