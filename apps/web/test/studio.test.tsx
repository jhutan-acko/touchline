import { act, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
import type { QueueItem } from "@touchline/rpc"
import type { Cue } from "@touchline/schema"
import { App } from "../src/App.js"
import { Studio } from "../src/Studio.js"
import { fakeClient } from "./fake-client.js"

const segment = { mode: "casual", lang: "en", club: null } as const
const cue = (id: string, headline: string): Cue => ({
  cue_id: `${id}-casual.en.neutral`, schema: "touchline.cue/1", match_id: "m", moment_id: id,
  anchor: { frame_from: 100, frame_to: 120, clock: "12:00" }, display: { slot: "lower_third", priority: 1, ttl_ms: 12000, template: "goal" },
  segment, text: { headline, body: "A finish." }, data: {}, evidence: [], verified: true
})
const item = (id: string, headline: string, status: QueueItem["status"] = "pending"): QueueItem => ({
  moment_id: id, frame: 120, clock: "12:00", status, cue: cue(id, headline), points: [`${headline} — point`, "Cause: clear chance converted"], variants: 12
})

const row = (headline: string) => within(screen.getByRole("list", { name: "Queue" })).getByText(headline).closest("li") as HTMLElement

describe("studio console", () => {
  it("lists queued moments as they arrive and sends the producer's decisions", async () => {
    const client = fakeClient()
    render(<Studio client={client} session="s1" segment={segment} />)
    expect(screen.getByText("No moments yet.")).toBeTruthy()
    act(() => client.pushStudio({ kind: "queue", item: item("mo-1", "Wylford scores") }))
    act(() => client.pushStudio({ kind: "queue", item: item("mo-2", "Pressure builds") }))
    const items = within(screen.getByRole("list", { name: "Queue" })).getAllByRole("listitem")
    expect(items.map((li) => li.querySelector("h3")?.textContent)).toEqual(["Pressure builds", "Wylford scores"]) // newest first
    expect(within(row("Wylford scores")).getByText("Pending")).toBeTruthy()
    await userEvent.click(within(row("Wylford scores")).getByRole("button", { name: "Send to graphics" }))
    expect(client.calls).toContain("act mo-1 send")
    expect(within(row("Wylford scores")).getByText("On air")).toBeTruthy()
    await userEvent.click(within(row("Pressure builds")).getByRole("button", { name: "Hold" }))
    expect(within(row("Pressure builds")).getByText("Held")).toBeTruthy()
  })

  it("gives the presenter talking points for approved and on-air moments only", async () => {
    const client = fakeClient()
    render(<Studio client={client} session="s1" segment={segment} />)
    act(() => client.pushStudio({ kind: "queue", item: item("mo-1", "Wylford scores") }))
    const points = screen.getByRole("region", { name: "Talking points" })
    expect(within(points).getByText("Approve a moment to add its talking points.")).toBeTruthy()
    await userEvent.click(within(row("Wylford scores")).getByRole("button", { name: "Approve" }))
    expect(within(points).getByText("Wylford scores — point")).toBeTruthy()
    expect(within(points).getByText("Cause: clear chance converted")).toBeTruthy()
    act(() => client.pushStudio({ kind: "queue", item: item("mo-1", "Wylford scores", "held") })) // another producer held it
    expect(within(points).queryByText("Cause: clear chance converted")).toBeNull()
  })

  it("shows every agent cue in the raw feed, with its segment and slot", () => {
    const client = fakeClient()
    render(<Studio client={client} session="s1" segment={segment} />)
    act(() => client.pushStudio({ kind: "cue", cue: cue("mo-1", "Wylford scores") }))
    const feed = screen.getByRole("list", { name: "Raw cue feed" })
    expect(within(feed).getByText(/casual\.en\.neutral · lower_third/)).toBeTruthy()
  })

  it("says when the connection is lost, follows the session again and keeps the queue; says when the session is gone", async () => {
    const client = fakeClient()
    render(<Studio client={client} session="s1" segment={segment} />)
    act(() => client.pushStudio({ kind: "queue", item: item("mo-1", "Wylford scores") }))
    act(() => client.failStudio("Socket closed"))
    expect(screen.getByRole("status").textContent).toBe("Connection lost — trying again…")
    expect(row("Wylford scores")).toBeTruthy() // the queue stays on screen meanwhile
    await waitFor(() => expect(client.studioCount()).toBe(2), { timeout: 3000 })
    act(() => client.pushStudio({ kind: "playback", playback: { state: "playing", frame: 10, speed: 4, live: false } }))
    expect(screen.queryByRole("status")).toBeNull()
    act(() => client.failStudio("SessionNotFound: s1"))
    expect(screen.getByRole("status").textContent).toBe("This session has ended.")
  })

  it("opens from a session in the fan app, for the viewer's segment", async () => {
    const client = fakeClient()
    render(<App client={client} />)
    await userEvent.click(await screen.findByRole("button", { name: "Watch" }))
    expect(screen.getByRole("link", { name: "Studio console" }).getAttribute("href")).toBe("#/studio/s1?seg=casual.en.neutral")
  })
})
