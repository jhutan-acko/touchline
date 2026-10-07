import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
import { App } from "../src/App.js"
import { fakeClient } from "./fake-client.js"

describe("a lost connection", () => {
  it("is shown and the session watched again; a session that is gone is said to be over", async () => {
    const client = fakeClient()
    render(<App client={client} />)
    await userEvent.click(await screen.findByRole("button", { name: "Watch" }))
    expect(client.watchCount()).toBe(1)
    act(() => client.fail("Socket closed"))
    expect(screen.getByRole("status").textContent).toBe("Connection lost — trying again…")
    await waitFor(() => expect(client.watchCount()).toBe(2), { timeout: 3000 })
    act(() => client.push({ kind: "playback", playback: { state: "playing", frame: 10, speed: 4, live: false } }))
    expect(screen.queryByRole("status")).toBeNull()
    act(() => client.fail("SessionNotFound: s1"))
    expect(screen.getByRole("status").textContent).toBe("This session has ended.")
  })

  it("does not break the page when starting a session fails", async () => {
    const client = fakeClient()
    client.startSession = async () => { throw new Error("Socket closed") }
    render(<App client={client} />)
    await userEvent.click(await screen.findByRole("button", { name: "Watch" }))
    expect(await screen.findByRole("alert")).toBeTruthy()
  })
})

describe("recaps before the whistle", () => {
  it("are asked of the session and shown as not yet", async () => {
    const client = fakeClient()
    render(<App client={client} />)
    await userEvent.click(await screen.findByRole("button", { name: "Watch" }))
    await userEvent.click(screen.getByRole("button", { name: "Full-time" }))
    expect(await screen.findByText("Not yet: the recap comes at the whistle.")).toBeTruthy()
    expect(client.calls).toContain("recap s1 full_time")
  })
})
