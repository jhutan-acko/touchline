import { act, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import type { AskAnswer } from "@touchline/rpc"
import type { QuestionChip } from "../src/client.js"
import type { Segment } from "@touchline/schema"
import { AskPanel, markerQuestion } from "../src/AskPanel.js"
import { fakeClient } from "./fake-client.js"

const EN: Segment = { mode: "casual", lang: "en", club: null }
const chips: QuestionChip[] = [
  { chip_id: "c-holder", text: "Why didn't he pass to the winger?", intent: { kind: "what_if", subject_id: "p-nor-01", fork_event_id: null, intervention: { kind: "pass_to", player_id: "p-nor-01", receiver_id: "p-nor-07" }, reason: null } },
  { chip_id: "c-press", text: "Who's pressing him?", intent: { kind: "explain", subject_id: "p-nor-01", fork_event_id: null, intervention: null, reason: null } }
]
const answer = (o: Partial<AskAnswer> = {}): AskAnswer => ({
  headline: "The winger was open", body: "Six of twenty re-runs ended in a shot.", verified: true, model: "stub",
  chips: [
    { label: "Shots (alt)", value: "6 / 20", source: "what_if" },
    { label: "Shots (played)", value: "1 / 20", source: "what_if" },
    { label: "Distance", value: "9.8 km", source: "stats" },
    { label: "Pass", value: "e679", source: "event" }
  ],
  ask_id: "a1", frame: 9900, clip_id: "clip-1", verdict: "better_option_found", cached: false, ...o
})

const panel = async (o: { segment?: Segment; prefill?: string } = {}) => {
  const client = fakeClient({ chips })
  const onShowMe = vi.fn()
  render(<AskPanel client={client} sessionId="s1" frame={9900} segment={o.segment ?? EN} onShowMe={onShowMe} onClose={() => {}} {...(o.prefill ? { prefill: o.prefill } : {})} />)
  return { client, onShowMe }
}
const rows = () => within(screen.getByRole("list", { name: "Agents" })).getAllByRole("listitem")
const stateOf = (name: string) => rows().find((r) => r.dataset.stage === name)?.dataset.state

describe("the Ask panel", () => {
  it("lists suggested chips and asks with chip_id", async () => {
    const { client } = await panel()
    expect(client.calls).toEqual(["suggest 9900 en"])
    await userEvent.click(await screen.findByRole("button", { name: "Why didn't he pass to the winger?" }))
    expect(client.asks).toHaveLength(1)
    expect(client.asks[0]!.req).toEqual({ frame: 9900, question: "Why didn't he pass to the winger?", chip_id: "c-holder", segment: EN })
    // A typed question goes without a chip.
    await userEvent.type(screen.getByRole("textbox", { name: "Ask about this moment" }), "Where was the striker?{Enter}")
    expect(client.asks[1]!.req).toEqual({ frame: 9900, question: "Where was the striker?", chip_id: null, segment: EN })
  })

  it("starts with the pre-filled question in the box", async () => {
    await panel({ prefill: "Who's pressing #9 Feseo Wylford?" })
    expect((screen.getByRole("textbox", { name: "Ask about this moment" }) as HTMLInputElement).value).toBe("Who's pressing #9 Feseo Wylford?")
  })

  it("ticks stages as updates arrive", async () => {
    const { client } = await panel()
    await userEvent.click(await screen.findByRole("button", { name: "Who's pressing him?" }))
    expect(rows().map((r) => r.dataset.stage)).toEqual(["question", "analyst", "factcheck", "personalise"])
    expect(rows().every((r) => r.dataset.state === "pending")).toBe(true)
    act(() => client.pushAsk({ kind: "stage", stage: { stage: "question", status: "Reading the question…" } }))
    expect(stateOf("question")).toBe("working")
    expect(screen.getByText("Reading the question…")).toBeTruthy()
    act(() => client.pushAsk({ kind: "stage", stage: { stage: "whatif", status: "Re-running 20 futures with the pass to #7" } }))
    expect(rows().map((r) => r.dataset.stage)).toEqual(["question", "whatif", "analyst", "factcheck", "personalise"])
    expect(stateOf("question")).toBe("done")
    expect(stateOf("whatif")).toBe("working")
    act(() => client.pushAsk({ kind: "stage", stage: { stage: "analyst", status: "Gathering evidence" } }))
    act(() => client.pushAsk({ kind: "stage", stage: { stage: "factcheck", status: "Checking 3 numbers…" } }))
    expect([stateOf("whatif"), stateOf("analyst"), stateOf("factcheck"), stateOf("personalise")]).toEqual(["done", "done", "working", "pending"])
    act(() => client.pushAsk({ kind: "answer", answer: answer() }))
    expect(rows().every((r) => r.dataset.state === "done")).toBe(true)
    const card = screen.getByRole("article")
    expect(within(card).getByText("The winger was open")).toBeTruthy()
    expect(within(card).getByText("Six of twenty re-runs ended in a shot.")).toBeTruthy()
    expect(within(card).getAllByTestId("evidence-chip")).toHaveLength(4)
    expect(within(card).getByText("The alternative was better")).toBeTruthy()
  })

  it("shows Fact-checked only when verified", async () => {
    const { client } = await panel()
    await userEvent.click(await screen.findByRole("button", { name: "Who's pressing him?" }))
    act(() => client.pushAsk({ kind: "answer", answer: answer({ verified: false }) }))
    expect(screen.queryByText("Fact-checked ✓")).toBeNull()
    await userEvent.click(screen.getByRole("button", { name: "Who's pressing him?" }))
    act(() => client.pushAsk({ kind: "answer", answer: answer({ verified: true }) }))
    expect(screen.getByText("Fact-checked ✓")).toBeTruthy()
  })

  it("labels not_verified as too close to call", async () => {
    const { client } = await panel()
    await userEvent.click(await screen.findByRole("button", { name: "Who's pressing him?" }))
    act(() => client.pushAsk({ kind: "answer", answer: answer({ verdict: "not_verified" }) }))
    expect(screen.getByText("Too close to call")).toBeTruthy()
    expect(screen.queryByText("The alternative was better")).toBeNull()
    act(() => client.pushAsk({ kind: "answer", answer: answer({ verdict: "played_pass_was_best" }) }))
    expect(screen.getByText("What he did was as good or better")).toBeTruthy()
  })

  it("hides Show me without a clip", async () => {
    const { client, onShowMe } = await panel()
    await userEvent.click(await screen.findByRole("button", { name: "Who's pressing him?" }))
    act(() => client.pushAsk({ kind: "answer", answer: answer({ clip_id: null, verdict: null }) }))
    expect(screen.queryByRole("button", { name: "Show me" })).toBeNull()
    act(() => client.pushAsk({ kind: "answer", answer: answer() }))
    await userEvent.click(screen.getByRole("button", { name: "Show me" }))
    expect(onShowMe).toHaveBeenCalledWith("clip-1")
  })

  it("stops the previous ask when a new one starts", async () => {
    const { client } = await panel()
    await userEvent.click(await screen.findByRole("button", { name: "Who's pressing him?" }))
    await userEvent.click(screen.getByRole("button", { name: "Why didn't he pass to the winger?" }))
    expect(client.asks.map((a) => a.stopped)).toEqual([true, false])
    // The old stream ending (as it is interrupted) or sending late updates changes nothing.
    act(() => client.asks[0]!.onUpdate({ kind: "answer", answer: answer({ headline: "Stale" }) }))
    act(() => client.asks[0]!.onEnd())
    expect(screen.queryByText("Stale")).toBeNull()
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("stops the last stage, not leaving it working, when the ask fails", async () => {
    const { client } = await panel()
    await userEvent.click(await screen.findByRole("button", { name: "Who's pressing him?" }))
    act(() => client.pushAsk({ kind: "stage", stage: { stage: "question", status: "Reading the question…" } }))
    act(() => client.pushAsk({ kind: "stage", stage: { stage: "analyst", status: "Looking at the frame…" } }))
    expect(stateOf("analyst")).toBe("working")
    act(() => client.pushAsk({ kind: "failed", reason: "timeout", message: "" }))
    expect(stateOf("question")).toBe("done")
    expect(stateOf("analyst")).toBe("stopped")
    expect(stateOf("factcheck")).toBe("pending")
    expect(document.querySelector(".animate-pulse")).toBeNull()
  })

  it("does not repeat the verdict when the headline already says it", async () => {
    const { client } = await panel()
    await userEvent.click(await screen.findByRole("button", { name: "Who's pressing him?" }))
    act(() => client.pushAsk({ kind: "answer", answer: answer({ headline: "Too close to call", verdict: "not_verified" }) }))
    expect(screen.getAllByText("Too close to call")).toHaveLength(1)
  })

  it("shows the offline copy on failed:offline in hi", async () => {
    const { client } = await panel({ segment: { mode: "casual", lang: "hi", club: null } })
    expect(client.calls).toEqual(["suggest 9900 hi"])
    await userEvent.click(await screen.findByRole("button", { name: "Who's pressing him?" }))
    act(() => client.pushAsk({ kind: "failed", reason: "offline", message: "agents down" }))
    expect(screen.getByRole("alert").textContent).toBe("विश्लेषक अभी ऑफ़लाइन हैं। थोड़ी देर बाद फिर पूछें।")
  })

  it("says the analysts are offline when the stream ends without an answer", async () => {
    const { client } = await panel()
    await userEvent.click(await screen.findByRole("button", { name: "Who's pressing him?" }))
    act(() => client.asks[0]!.onEnd())
    expect(screen.getByRole("alert").textContent).toBe("The analysts are offline right now. Try again in a moment.")
  })

  it("words timeouts and bad frames", async () => {
    const { client } = await panel({ segment: { mode: "casual", lang: "es", club: null } })
    await userEvent.click(await screen.findByRole("button", { name: "Who's pressing him?" }))
    act(() => client.pushAsk({ kind: "failed", reason: "timeout", message: "" }))
    expect(screen.getByRole("alert").textContent).toBe("Los analistas tardaron demasiado. Prueba otra vez.")
    act(() => client.pushAsk({ kind: "failed", reason: "bad_frame", message: "" }))
    expect(screen.getByRole("alert").textContent).toBe("Ese momento aún no se ha jugado. Vuelve al directo y pausa otra vez.")
  })
})

describe("markerQuestion", () => {
  const names = { "p-nor-07": "#7 Ivo Tarn", "p-lar-09": "#9 Feseo Wylford" }
  it("maps each marker to its question", () => {
    expect(markerQuestion({ template: "ghost", at: "p-nor-07", point: { x: 1, y: 2 } }, names, "en")).toBe("What if #7 Ivo Tarn got the ball here?")
    expect(markerQuestion({ template: "pressure_ring", at: "p-lar-09", count: 2 }, names, "en")).toBe("Who's pressing #9 Feseo Wylford?")
    expect(markerQuestion({ template: "pass_arc", from: "p-lar-09", to: "p-nor-07" }, names, "en")).toBe("Was passing to #7 Ivo Tarn the best option?")
    expect(markerQuestion({ template: "pressure_ring", at: "p-lar-09" }, names, "es")).toBe("¿Quién presiona a #9 Feseo Wylford?")
  })
})
