import { act, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it } from "vitest"
import type { BallEvent, PitchFrame } from "@touchline/rpc"
import { App } from "../src/App.js"
import { StatTags } from "../src/StatTags.js"
import { fakeClient } from "./fake-client.js"

beforeEach(() => localStorage.clear())

const frame = (n: number): PitchFrame => ({ frame: n, period: "first_half", clock: "10:00.00", ball: { x: 0, y: 0, z: 0 }, home: [{ id: "p-nor-01", x: -40, y: 0 }], away: [{ id: "p-lar-09", x: 30, y: 4 }] })
const shot = (n: number): BallEvent => ({
  id: `e-${n}`, frame: n, clock: "10:00", type: "shot", team: "away", player_id: "p-lar-09", receiver_id: null, outcome: "saved",
  x: 30, y: 4, x_end: 52, y_end: 1, length_m: null, xpass: null, speed_kmh: 96.4, xg: 0.12
})
const tags = () => [...screen.getByLabelText("stat tags").querySelectorAll("[data-tag]")].map((e) => e.textContent)

const watching = async () => {
  const client = fakeClient()
  render(<App client={client} />)
  await userEvent.click(await screen.findByRole("button", { name: "Watch" }))
  for (let n = 1; n <= 20; n++) act(() => client.push({ kind: "frame", frame: frame(n) }))
  return client
}

describe("stat tags", () => {
  it("show a shot's speed on the pitch once play reaches it, and go when turned off", async () => {
    const client = await watching()
    act(() => client.push({ kind: "event", event: shot(20) }))
    expect(tags()).toEqual(["96 km/h rocket!"]) // casual: no xG
    await userEvent.click(screen.getByLabelText("Stat tags"))
    expect(screen.getByLabelText("stat tags").children).toHaveLength(0)
    await userEvent.click(screen.getByLabelText("Stat tags"))
    expect(tags()).toEqual(["96 km/h rocket!"])
    // Three seconds of match time later it has gone.
    for (let n = 21; n <= 50; n++) act(() => client.push({ kind: "frame", frame: frame(n) }))
    expect(tags()).toEqual([])
  })

  it("keep a frozen viewer to what had arrived by the freeze", async () => {
    const client = await watching()
    await userEvent.click(screen.getByRole("button", { name: "Pause" }))
    for (let n = 21; n <= 24; n++) act(() => client.push({ kind: "frame", frame: frame(n) }))
    act(() => client.push({ kind: "event", event: shot(22) }))
    expect(tags()).toEqual([])
    await userEvent.click(screen.getByRole("button", { name: "Play" }))
    expect(tags()).toEqual(["96 km/h rocket!"])
  })

  it("place a tag over its spot on the pitch", () => {
    render(<StatTags tags={[{ key: "k", kind: "shot", frame: 1, text: "Shot", player_id: null, x: 0, y: 0, team: "home", opacity: 0.5, ok: null }]} />)
    const el = screen.getByText("Shot")
    expect(el.style.left).toBe("50%")
    expect(el.style.top).toBe("50%")
    expect(el.style.opacity).toBe("0.5")
  })
})
