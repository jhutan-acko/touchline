import { act, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { Cue, Decision } from "@touchline/schema"
import { App } from "../src/App.js"
import { MatchList } from "../src/MatchList.js"
import { minuteLabel } from "../src/Decisions.js"
import { DECISION_CARD_MS } from "../src/Watch.js"
import { fakeClient, INFO, MATCH } from "./fake-client.js"

const estimate = (mean: number, se: number) => ({ mean, se })
const DECISION: Decision = {
  match_id: "lib-costly_error-1", tick: 36000, minute: 60, side: "home", team_id: "northwick", manager: "agent", reasons: ["minute_60"], situation_hash: "h",
  options: [
    { index: 0, label: "No change", source: "no_change", orders: [], rationale: null, xg_diff_vs_no_change: estimate(0, 0), goal_diff_vs_no_change: estimate(0, 0), untested: false, dropped: [] },
    { index: 1, label: "Press higher", source: "agent", orders: [{ kind: "style", setting: "pressIntensity", value: 1 }], rationale: "Win it back.", xg_diff_vs_no_change: estimate(0.12, 0.05), goal_diff_vs_no_change: estimate(0.05, 0.04), untested: false, dropped: [] },
    { index: 2, label: "Fresh legs", source: "agent", orders: [{ kind: "sub", off: "p-nor-09", on: "p-nor-19" }], rationale: "Tired.", xg_diff_vs_no_change: null, goal_diff_vs_no_change: null, untested: true, dropped: [] }
  ],
  pick: 1, reason: "Press higher added 0.12 xG over no change.", orders_applied: [{ kind: "style", setting: "pressIntensity", value: 1 }], fallback: null,
  timings_ms: { propose: 4000, whatif: 6000, choose: 3000 }, tokens: { in: 2000, out: 200 }, cost_usd: 0, model: "openai:gpt-6.1-sol"
}
const cue = (d: Decision): Cue => ({
  cue_id: `decision-${d.tick}-${d.side}-casual.en.neutral`, schema: "touchline.cue/1", match_id: d.match_id, moment_id: `decision-${d.tick}-${d.side}`,
  anchor: { frame_from: d.tick, frame_to: d.tick, clock: "60:00" }, display: { slot: "lower_third", priority: 2, ttl_ms: 12000, template: "manager_decision" },
  segment: { mode: "casual", lang: "en", club: null }, text: { headline: "Northwick Mariners: Press higher", body: d.reason }, data: {}, evidence: [`decision-${d.tick}-${d.side}`], verified: true
})

const watching = async (decisions: ReadonlyArray<Decision> = [DECISION], managed = false) => {
  const client = fakeClient({ decisions, ...(managed ? { info: { ...INFO, managers: { home: "agent", away: "agent" } } } : {}) })
  const user = userEvent.setup(vi.isFakeTimers() ? { advanceTimers: vi.advanceTimersByTime } : {})
  render(<App client={client} />)
  await user.click(await screen.findByRole("button", { name: "Watch" }))
  await screen.findByRole("img", { name: "Northwick Mariners – Larkspur City" })
  return { client, user }
}

afterEach(() => vi.useRealTimers())

describe("a manager's decision", () => {
  it("opens its card when its cue arrives: every option with its re-simulated gain, the pick and the reason", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { client } = await watching()
    act(() => client.push({ kind: "cue", cue: cue(DECISION) }))
    const card = await screen.findByRole("dialog", { name: "Northwick Mariners · 60'" })
    expect(client.calls).toContain("decisions s1")
    const rows = within(card).getAllByRole("listitem")
    expect(rows.map((r) => r.textContent)).toEqual([
      "No change (no change)+0.00 ± 0.00",
      "Press higher (agent)Picked+0.12 ± 0.05",
      "Fresh legs (agent)not tested"
    ])
    expect(rows[1]!.getAttribute("aria-current")).toBe("true")
    expect(within(card).getByText("Press higher added 0.12 xG over no change.")).toBeTruthy()
    expect(within(card).getByText("60 minutes")).toBeTruthy()
    act(() => void vi.advanceTimersByTime(DECISION_CARD_MS))
    expect(screen.queryByRole("dialog")).toBeNull()
  })
  it("stays on the strip, which reopens the card until it is closed", async () => {
    const { client, user } = await watching()
    act(() => client.push({ kind: "cue", cue: cue(DECISION) }))
    await screen.findByRole("dialog")
    await user.click(screen.getByRole("button", { name: "Close" }))
    expect(screen.queryByRole("dialog")).toBeNull()
    await user.click(within(screen.getByRole("navigation", { name: "Manager decisions" })).getByRole("button", { name: "60' NOR" }))
    expect(screen.getByRole("dialog", { name: "Northwick Mariners · 60'" })).toBeTruthy()
  })
  it("opens its card from the feed's Why? instead of the evidence drawer", async () => {
    const { client, user } = await watching()
    act(() => client.push({ kind: "cue", cue: cue(DECISION) }))
    await user.click(await screen.findByRole("button", { name: "Close" }))
    await user.click(within(screen.getByRole("list", { name: "feed" })).getByRole("button", { name: "Why?" }))
    expect(await screen.findByRole("dialog", { name: "Northwick Mariners · 60'" })).toBeTruthy()
    expect(client.calls.some((c) => c.startsWith("evidence"))).toBe(false)
  })
  it("says when the manager agent could not decide", async () => {
    const fell = { ...DECISION, pick: 0, fallback: "choose" as const, reason: "The manager agent could not choose; the previous plan stays." }
    const { client } = await watching([fell])
    act(() => client.push({ kind: "cue", cue: cue(fell) }))
    expect(await screen.findByText("The manager agent could not decide here; this is its fallback.")).toBeTruthy()
  })
})

describe("watching a managed match from a later minute", () => {
  it("shows the decisions already reached on the strip at once, before any new one", async () => {
    const { client } = await watching([DECISION], true)
    const strip = await screen.findByRole("navigation", { name: "Manager decisions" })
    expect(await within(strip).findByRole("button", { name: "60' NOR" })).toBeTruthy()
    expect(client.calls).toContain("decisions s1")
    expect(screen.queryByRole("dialog")).toBeNull()
  })
})

describe("a moment when both managers decided", () => {
  it("has one marker naming both teams, and opens both cards", async () => {
    const away: Decision = { ...DECISION, side: "away", team_id: "larkspur", pick: 0, reason: "No option did better than keeping things as they are." }
    const { client, user } = await watching([DECISION, away])
    act(() => client.push({ kind: "cue", cue: cue(DECISION) }))
    act(() => client.push({ kind: "cue", cue: cue(away) }))
    expect(await screen.findByRole("dialog", { name: "Larkspur City · 60'" })).toBeTruthy()
    expect(screen.getByRole("dialog", { name: "Northwick Mariners · 60'" })).toBeTruthy()
    await user.click(screen.getAllByRole("button", { name: "Close" })[0]!)
    expect(screen.queryAllByRole("dialog")).toEqual([])
    await user.click(within(screen.getByRole("navigation", { name: "Manager decisions" })).getByRole("button", { name: "60' NOR·LAR" }))
    expect(screen.getAllByRole("dialog")).toHaveLength(2)
  })
})

describe("a decision's minute", () => {
  it("reads added time as a fan does: 45+3' before half time, 90+2' after", () => {
    const at = (tick: number, minute: number, reasons: Decision["reasons"] = ["after_goal"]) => ({ ...DECISION, tick, minute, reasons })
    const all = [at(29000, 45, ["half_time"])]
    expect(minuteLabel(at(28500, 47.6), all)).toBe("45+3'")
    expect(minuteLabel(at(29000, 45, ["half_time"]), all)).toBe("45'")
    expect(minuteLabel(at(31000, 48.2), all)).toBe("48'")
    expect(minuteLabel(at(57000, 91.4), all)).toBe("90+2'")
    expect(minuteLabel(at(1000, 1.2), [])).toBe("1'")
  })
})

describe("the match list", () => {
  it("names a managed match's managers", () => {
    render(<MatchList matches={[{ ...MATCH, managers: { home: "agent", away: "rules" } }]} lang="en" onWatch={() => {}} />)
    expect(screen.getByText(/Managers: agent v rules/)).toBeTruthy()
  })
})
