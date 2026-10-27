import { act, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PitchFrame } from "@touchline/rpc"
import type { Cue } from "@touchline/schema"
import { App } from "../src/App.js"
import { fakeClient, type FakeClient } from "./fake-client.js"

beforeEach(() => localStorage.clear())

const board = (n: number, clock: string, home: number, away: number, mh = 0.7): Cue => ({
  cue_id: `b-${n}`, schema: "touchline.cue/1", match_id: "m", moment_id: null, anchor: { frame_from: n, frame_to: n, clock },
  display: { slot: "top_bar", priority: 3, ttl_ms: 2000, template: "scoreboard" }, segment: { mode: "casual", lang: "en", club: null },
  text: null, data: { "score.home": home, "score.away": away, "team.mom.home": mh, "team.mom.away": 1 - mh }, evidence: [], verified: true
})
const chance = (n: number, clock: string): Cue => ({
  cue_id: `c-${n}`, schema: "touchline.cue/1", match_id: "m", moment_id: `mo-${n}`, anchor: { frame_from: n - 5, frame_to: n, clock },
  display: { slot: "lower_third", priority: 2, ttl_ms: 8000, template: "big_chance" }, segment: { mode: "analyst", lang: "en", club: null },
  text: { headline: "Big chance for Northwick", body: "xG 0.4" }, data: { "shot.xg": 0.4 }, evidence: ["e1"], verified: true
})
const frame = (n: number, clock: string): PitchFrame => ({ frame: n, period: "first_half", clock, ball: { x: 0, y: 0, z: 0 }, home: [{ id: "h", x: 0, y: 1 }], away: [{ id: "a", x: 40, y: 0 }] })
const push = (c: FakeClient, n: number, clock: string, ...cues: Cue[]) => act(() => (c.push({ kind: "frame", frame: frame(n, clock) }), cues.forEach((cue) => c.push({ kind: "cue", cue }))))

const watching = async (mode?: "analyst") => {
  const client = fakeClient()
  render(<App client={client} />)
  await userEvent.click(await screen.findByRole("button", { name: "Watch" }))
  if (mode) await userEvent.selectOptions(screen.getByLabelText("mode"), mode)
  return client
}
const strip = () => screen.getByRole("region", { name: "Match pulse" })

describe("pulse strip", () => {
  it("casual: momentum and goals only, friendly words, and nothing of the future", async () => {
    const client = await watching()
    push(client, 100, "10:00.00", board(100, "10:00", 0, 0))
    push(client, 200, "20:00.00", board(200, "20:00", 1, 0), chance(200, "20:00"))
    const s = within(strip())
    expect(s.getByTestId("pulse-lead").textContent).toBe("Northwick Mariners on top")
    expect(s.getByTestId("pulse-home").getAttribute("d")).toMatch(/^M/)
    expect(s.queryByTestId("pulse-band")).toBeNull()
    const goals = s.getAllByRole("button")
    expect(goals.map((b) => b.getAttribute("data-kind"))).toEqual(["goal"])
    expect(goals[0]!.getAttribute("title")).toMatch(/^20' · Goal 1–0 · Click to pause here and ask/)
    // the "now" line sits at minute 20 of 90; the strip says nothing about what is later
    expect(Number(s.getByTestId("pulse-now").getAttribute("x1"))).toBeCloseTo((20 / 90) * 1000, 0)
  })

  it("clicking a goal still in the ring buffer freezes there and opens Ask", async () => {
    const client = await watching()
    push(client, 100, "10:00.00", board(100, "10:00", 0, 0))
    push(client, 200, "20:00.00", board(200, "20:00", 1, 0))
    await userEvent.click(within(strip()).getByRole("button", { name: /Goal/ }))
    expect(await screen.findByRole("region", { name: "Ask" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Play" })).toBeTruthy()
    expect(client.calls).toContain("suggest 200 en")
  })

  it("analyst: control-versus-chaos band with its explanation, every moment, numbers in the tooltips", async () => {
    const client = await watching("analyst")
    push(client, 100, "10:00.00", board(100, "10:00", 0, 0))
    push(client, 200, "20:00.00", board(200, "20:00", 0, 0), chance(200, "20:00"))
    const s = within(strip())
    expect(s.getByTestId("pulse-band").getAttribute("title")).toMatch(/changes hands/)
    expect(s.getByTestId("pulse-how").textContent).toMatch(/6 or more is chaos/)
    expect(s.getAllByRole("button").map((b) => b.getAttribute("data-kind"))).toEqual(["chance"])
    expect(s.getByRole("button").getAttribute("title")).toMatch(/^20' · Big chance · Big chance for Northwick/)
    // minute 10 was the first watched minute: judged (no turnovers: control)
    const ten = screen.getByTitle(/^10–11' · Control/)
    expect(ten.getAttribute("data-state")).toBe("control")
    expect(screen.getByTitle(/^3–4' · not watched/).getAttribute("data-state")).toBe("none")
  })

  it("a moment older than the ring buffer opens the Why drawer for its cue", async () => {
    const client = await watching("analyst")
    push(client, 100, "10:00.00", board(100, "10:00", 0, 0), chance(100, "10:00"))
    push(client, 900, "50:00.00", board(900, "50:00", 0, 0)) // 30 s ring: frame 100 is long gone
    const m = within(strip()).getByRole("button")
    expect(m.getAttribute("data-action")).toBe("why")
    await userEvent.click(m)
    await vi.waitFor(() => expect(client.calls).toContain("evidence c-100"))
    expect(screen.queryByRole("region", { name: "Ask" })).toBeNull()
  })

  it("frozen: a goal scored after the frozen frame stays off the strip", async () => {
    const client = await watching()
    push(client, 100, "10:00.00", board(100, "10:00", 0, 0))
    await userEvent.click(screen.getByRole("button", { name: "Pause" }))
    push(client, 200, "20:00.00", board(200, "20:00", 1, 0))
    expect(within(strip()).queryAllByRole("button")).toHaveLength(0)
    expect(Number(within(strip()).getByTestId("pulse-now").getAttribute("x1"))).toBeCloseTo((10 / 90) * 1000, 0)
    await userEvent.click(screen.getByRole("button", { name: "Play" }))
    expect(within(strip()).getAllByRole("button")).toHaveLength(1)
  })

  it("speaks Spanish and Hindi", async () => {
    const client = fakeClient()
    render(<App client={client} />)
    await userEvent.click(await screen.findByRole("button", { name: "Watch" }))
    await userEvent.selectOptions(screen.getAllByLabelText("Language").at(-1)!, "es")
    expect(screen.getByRole("region", { name: "Pulso del partido" })).toBeTruthy()
    await userEvent.selectOptions(screen.getAllByLabelText("Idioma").at(-1)!, "hi")
    expect(screen.getByRole("region", { name: "मैच की नब्ज़" })).toBeTruthy()
  })
})
