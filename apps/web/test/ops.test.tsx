import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
import type { OpsReport } from "@touchline/rpc"
import { App } from "../src/App.js"
import { Ops } from "../src/Ops.js"
import { fakeClient } from "./fake-client.js"

const report = (over: Partial<OpsReport> = {}): OpsReport => ({
  session_id: "s1", live: true, frame: 30000, models: ["openai:gpt-6.1-sol"], moments: 9, cues: 108,
  fact_check: { pass: 8, retry: 2, drop: 1 }, fallbacks: { narrator: 1 },
  agents: [{ agent: "analyst", n: 9, p50: 4800, p95: 6100, max: 6300 }, { agent: "narrator", n: 9, p50: 2100, p95: 2900, max: 3000 }],
  requests: { ok: 14, timeout: 2 }, late_cues: 3, unverified_cues: 0,
  latency: {
    stats: { n: 3, p50: 0.4, p95: 1.2, max: 1.2, missed: 0, budget_ms: 250, ok: true },
    insight: { n: 9, p50: 3100, p95: 5200, max: 5600, missed: 0, budget_ms: 4000, ok: false, source: "live" }
  },
  ...over
})

const tile = (name: string) => screen.getByRole("region", { name })

describe("ops view", () => {
  it("shows latency against the spec's budgets, fact-check verdicts, time per agent and requests", async () => {
    render(<Ops client={fakeClient({ ops: report() })} session="s1" lang="en" />)
    const stats = await screen.findByRole("region", { name: "Stats overlay: goal to scoreboard" })
    expect(within(stats).getByText("Within budget")).toBeTruthy()
    expect(within(stats).getByText("p95 1.2 ms / 250 ms")).toBeTruthy()
    const insight = tile("AI insight: signal to cue")
    expect(within(insight).getByText("Over budget")).toBeTruthy()
    expect(within(insight).getByText("p95 5200 ms / 4000 ms")).toBeTruthy()
    const fc = tile("Fact-check verdicts")
    expect([within(fc).getByTestId("pass").textContent, within(fc).getByTestId("retry").textContent, within(fc).getByTestId("drop").textContent]).toEqual(["8", "2", "1"])
    const rows = within(tile("Time per agent")).getAllByRole("row").slice(1).map((r) => [...r.querySelectorAll("td")].map((c) => c.textContent))
    expect(rows).toEqual([["analyst", "9", "4800", "6100"], ["narrator", "9", "2100", "2900"]])
    expect(within(tile("Agent requests")).getByText("timeout: 2")).toBeTruthy()
    expect(within(tile("Fallbacks")).getByText("narrator: 1")).toBeTruthy()
    expect(screen.getByText("openai:gpt-6.1-sol")).toBeTruthy()
  })

  it("says when there are no measurements yet, and labels recorded request times as such", async () => {
    const quiet = report({ live: false, latency: { stats: { n: 0, p50: null, p95: null, max: null, missed: 0, budget_ms: 250, ok: null }, insight: { n: 0, p50: null, p95: null, max: null, missed: 0, budget_ms: 4000, ok: null, source: "recorded" } } })
    render(<Ops client={fakeClient({ ops: quiet })} session="s1" lang="en" />)
    expect(await within(await screen.findByRole("region", { name: "Stats overlay: goal to scoreboard" })).findByText("No measurements yet")).toBeTruthy()
    expect(within(tile("AI insight: signal to cue")).getByText("recorded request time")).toBeTruthy()
  })

  it("counts insights that never came as a miss, even with no measurements", async () => {
    const lost = report({ latency: { ...report().latency, insight: { n: 0, p50: null, p95: null, max: null, missed: 3, budget_ms: 4000, ok: false, source: "live" } } })
    render(<Ops client={fakeClient({ ops: lost })} session="s1" lang="en" />)
    const insight = await screen.findByRole("region", { name: "AI insight: signal to cue" })
    expect(within(insight).getByText("Over budget")).toBeTruthy()
    expect(within(insight).getByText("3 missed (failed or timed out)")).toBeTruthy()
  })

  it("refreshes every two seconds, and says when the session is gone", async () => {
    const client = fakeClient({ ops: report() })
    render(<Ops client={client} session="s1" lang="en" />)
    await waitFor(() => expect(client.calls.filter((c) => c === "ops s1").length).toBeGreaterThanOrEqual(2), { timeout: 3500 })
    render(<Ops client={fakeClient()} session="gone" lang="en" />)
    expect(await screen.findByText("This session has ended.")).toBeTruthy()
  })

  it("opens from a session in the fan app, in the viewer's language", async () => {
    const client = fakeClient()
    render(<App client={client} />)
    await userEvent.click(await screen.findByRole("button", { name: "Watch" }))
    expect(screen.getByRole("link", { name: "Ops view" }).getAttribute("href")).toBe("#/ops/s1?lang=en")
  })
})
