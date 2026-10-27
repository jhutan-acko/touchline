import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { AskClip, PitchFrame } from "@touchline/rpc"
import { AskSplit } from "../src/AskSplit.js"
import type { Play, Stage3DProps } from "../src/view3d/Stage3D.js"
import { INFO, fakeClient } from "./fake-client.js"

// jsdom has no WebGL: the stage is a stand-in; it keeps the plays it was given so the test can sample them.
const seen: { plays: Stage3DProps["plays"] | null } = { plays: null }
vi.mock("../src/view3d/Stage3D.js", () => ({
  Stage3D: (p: Stage3DProps) => {
    seen.plays = p.plays
    return (
      <div data-testid="stage" data-mode={p.mode}>
        {(["real", "variant"] as const).map((world) => <span key={world}>{p.label({ key: world, x: 0, y: 0, w: 1, h: 1, world, camera: p.camera, inset: false })}</span>)}
      </div>
    )
  }
}))

const frame = (n: number): PitchFrame => ({ frame: n, period: "first_half", clock: "16:30.00", ball: { x: 0, y: 0, z: 0 }, home: [{ id: "p-nor-01", x: 0, y: 0 }], away: [{ id: "p-lar-09", x: 5, y: 0 }] })
// Forked at 9900 (2 s lead-in from 9880), paused at 9910; the real frames run on past the pause (a server bug the split must not show).
const clip: AskClip = {
  clip_id: "clip-1", fork_frame: 9900, paused_frame: 9910, fps: 10,
  intervention: { kind: "pass_to", player_id: "p-lar-09", receiver_id: "p-nor-01" }, verdict: "better_option_found",
  real: Array.from({ length: 60 }, (_, i) => frame(9880 + i)), variant: Array.from({ length: 120 }, (_, i) => frame(9880 + i)),
  seeds: 20, horizon_s: 10, typical_seed: 8, shots: { played: 1, alt: 6 }, goals: { played: 0, alt: 2 }, gain: { mean: 0.2, se: 0.05 }
}

const open = async (c: AskClip = clip, ready = true) => {
  const client = fakeClient({ askClip: async () => c })
  const onClose = vi.fn()
  render(<AskSplit client={client} sessionId="s1" clipId="clip-1" match={INFO} lang="en" onClose={onClose} />)
  if (ready) await screen.findByTestId("stage")
  const split = await screen.findByRole("region", { name: "What if" })
  return { client, onClose, split }
}
const realAt = (now = 0) => (seen.plays!.real as Play).sample(now)
const scrub = (split: HTMLElement, f: number) => act(() => void fireEvent.change(within(split).getByRole("slider"), { target: { value: String(f) } }))

describe("the Ask split", () => {
  it("never renders a real frame after paused_frame", async () => {
    const { client, split } = await open()
    expect(client.calls).toEqual(["askClip clip-1"])
    expect(within(split).getByTestId("stage").dataset.mode).toBe("split")
    for (const f of [0, 20, 30, 31, 45, 59, 80, 119]) {
      scrub(split, f)
      expect(realAt()!.frame).toBeLessThanOrEqual(clip.paused_frame)
      expect((seen.plays!.variant as Play).sample(0)!.frame).toBeCloseTo(9880 + f)
    }
    // Past the pause the real side holds on the paused frame, and says so.
    expect(realAt()!.frame).toBe(9910)
    expect(within(split).getByText("You paused here", { selector: "[data-testid=paused]" })).toBeTruthy()
    expect(within(split).getByText(/What happened · You paused here/)).toBeTruthy()
    scrub(split, 10)
    expect(within(split).queryByTestId("paused")).toBeNull()
  })

  it("shows the counts", async () => {
    const { split, onClose } = await open()
    const strip = within(split).getByTestId("evidence-strip")
    expect(strip.textContent).toMatch(/6 \/ 20 vs 1 \/ 20/)
    expect(strip.textContent).toMatch(/Goals: 2 vs 0/)
    expect(strip.textContent).toMatch(/\+0\.20 ± 0\.05/)
    expect(strip.textContent).toMatch(/The alternative was better/)
    expect(within(split).getByText("What if · pass to #1 Datan Drenussen")).toBeTruthy()
    fireEvent.click(within(split).getByRole("button", { name: "Back to live" }))
    expect(onClose).toHaveBeenCalled()
  })

  it("says so when the alternative could not be played", async () => {
    const { split } = await open({ ...clip, variant: null, verdict: "not_verified", shots: null, goals: null, gain: null, typical_seed: null }, false)
    expect(await within(split).findByText("Couldn't re-simulate this moment")).toBeTruthy()
  })
})
