import { act, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PitchFrame, Tick } from "@touchline/rpc"
import { App } from "../src/App.js"
import type { BallEvent } from "../src/events.js"
import type { PlayerStats } from "../src/follow.js"
import { PlayerCard } from "../src/PlayerCard.js"
import { loadPlayer, PLAYER_KEY, savePlayer } from "../src/profile.js"
import type { Stage3DProps } from "../src/view3d/Stage3D.js"
import { fakeClient, INFO, type FakeClient } from "./fake-client.js"

vi.mock("../src/view3d/webgl.js", () => ({ hasWebGL: () => true }))
vi.mock("../src/view3d/Stage3D.js", () => ({
  Stage3D: (p: Stage3DProps) => <div data-testid="stage" data-camera={p.camera} data-followed={p.followed ?? ""} />
}))
beforeEach(() => localStorage.clear())

const ev = (o: Partial<BallEvent> & Pick<BallEvent, "id" | "frame">): BallEvent => ({
  clock: "10:00", type: "pass", team: "away", player_id: "p-lar-09", receiver_id: null, outcome: "success",
  x: 0, y: 0, x_end: null, y_end: null, length_m: null, xpass: 0.8, speed_kmh: null, xg: null, ...o
})
const striker = INFO.players.find((p) => p.id === "p-lar-09")!
const LARKSPUR = { name: "Larkspur City", kit: { primary: "#dc2626" } }
const stats = (o: Partial<PlayerStats> = {}): PlayerStats => ({
  km: 4.234, kmh: 12.4, topKmh: 31.26, passes: { done: 18, tried: 21 }, accuracy: (100 * 18) / 21, shots: 2, goals: 1, difficulty: 23.6,
  moments: [ev({ id: "m3", frame: 300, clock: "12:01", type: "shot", outcome: "goal" }), ev({ id: "m2", frame: 200, clock: "11:40", type: "tackle", outcome: "fail" }), ev({ id: "m1", frame: 100, clock: "11:02" })],
  ...o
})

describe("the player card", () => {
  it("casual: one friendly line", () => {
    render(<PlayerCard player={striker} team={LARKSPUR} stats={stats()} mode="casual" lang="en" />)
    const card = screen.getByRole("complementary", { name: "Player card" })
    expect(within(card).getByRole("heading", { name: "Feseo Wylford" })).toBeTruthy()
    expect(within(card).getByText("#9 · Larkspur City")).toBeTruthy()
    expect(within(card).getByTestId("card-casual").textContent).toBe("Ran 4.2 km · top speed 31 km/h · 18/21 passes")
    expect(within(card).queryByText("Avg pass difficulty")).toBeNull()
  })

  it("analyst: the numbers, in the viewer's language", () => {
    render(<PlayerCard player={striker} team={LARKSPUR} stats={stats()} mode="analyst" lang="es" />)
    const val = (k: string) => document.querySelector(`[data-stat="${k}"]`)!.textContent
    expect(val("cardDistance")).toBe("4.23 km")
    expect(val("cardSpeed")).toBe("12 km/h")
    expect(val("cardTop")).toBe("31.3 km/h")
    expect(val("cardPasses")).toBe("18/21 · 86%")
    expect(val("cardShots")).toBe("2 (1 ⚽)")
    expect(val("cardDifficulty")).toBe("24%")
    expect(screen.getByText("Velocidad máxima")).toBeTruthy()
  })

  it("lists the last moments; a held one freezes on its frame, an older one is not a button", async () => {
    const onMoment = vi.fn()
    render(<PlayerCard player={striker} team={LARKSPUR} stats={stats()} mode="casual" lang="en" canShow={(f) => f >= 150} onMoment={onMoment} />)
    const items = within(screen.getByRole("list", { name: "Last moments" })).getAllByRole("listitem")
    expect(items.map((i) => i.textContent)).toEqual(["12:01Shot⚽", "11:40Tackle✗", "11:02Pass✓"])
    await userEvent.click(within(items[0]!).getByRole("button", { name: /Shot/ }))
    expect(onMoment).toHaveBeenCalledWith(300)
    expect(within(items[2]!).queryByRole("button")).toBeNull()
  })

  it("unknown numbers show as a dash; no moments yet says so", () => {
    render(<PlayerCard player={striker} team={LARKSPUR} stats={stats({ km: null, kmh: null, topKmh: null, passes: { done: 0, tried: 0 }, accuracy: null, difficulty: null, moments: [] })} mode="analyst" lang="en" />)
    expect(document.querySelector('[data-stat="cardDistance"]')!.textContent).toBe("— km")
    expect(document.querySelector('[data-stat="cardPasses"]')!.textContent).toBe("0/0")
    expect(screen.getByText("No touches yet")).toBeTruthy()
  })
})

describe("the favourite player in the profile", () => {
  it("is remembered in this browser", () => {
    expect(loadPlayer()).toBeNull()
    savePlayer("p-lar-09")
    expect(localStorage.getItem(PLAYER_KEY)).toBe("p-lar-09")
    expect(loadPlayer()).toBe("p-lar-09")
    savePlayer(null)
    expect(loadPlayer()).toBeNull()
  })
})

/** The striker jogs 0.5 m a frame (18 km/h) along x. */
const frame = (n: number): PitchFrame => ({
  frame: n, period: "first_half", clock: `10:${String(n).padStart(2, "0")}.00`, ball: { x: 0, y: 0, z: 0 },
  home: [{ id: "p-nor-01", x: -50, y: 0 }], away: [{ id: "p-lar-09", x: n * 0.5, y: 0 }]
})
const push = (client: FakeClient, t: Tick | { kind: "event"; event: BallEvent }) => act(() => client.push(t as Tick))
const shown = () => screen.getByRole("img", { name: "Northwick Mariners – Larkspur City" })
const card = () => screen.queryByRole("complementary", { name: "Player card" })

const watching = async () => {
  const client = fakeClient()
  render(<App client={client} />)
  await userEvent.click(await screen.findByRole("button", { name: "Watch" }))
  return client
}

describe("following the favourite player while watching", () => {
  it("picks from both squads, highlights the player, and the card counts up to the frame shown (frozen: the frozen one)", async () => {
    const client = await watching()
    const picker = screen.getByLabelText("Favourite player")
    expect(within(picker).getAllByRole("group").map((g) => g.getAttribute("label"))).toEqual(["Northwick Mariners", "Larkspur City"])
    expect(card()).toBeNull()
    await userEvent.selectOptions(picker, "p-lar-09")
    expect(localStorage.getItem(PLAYER_KEY)).toBe("p-lar-09")
    for (let n = 1; n <= 30; n++) push(client, { kind: "frame", frame: frame(n) })
    push(client, { kind: "event", event: ev({ id: "e1", frame: 12, clock: "10:12" }) })
    push(client, { kind: "event", event: ev({ id: "e2", frame: 20, clock: "10:20", outcome: "fail" }) })
    push(client, { kind: "event", event: ev({ id: "e0", frame: 15, player_id: "p-nor-01", team: "home" }) })
    expect(shown().dataset.focus).toBe("p-lar-09")
    expect(within(card()!).getByTestId("card-casual").textContent).toBe("Ran 0.0 km · top speed 18 km/h · 1/2 passes")
    // Freeze, then more happens underneath: the card stays as it was.
    await userEvent.click(screen.getByRole("button", { name: "Pause" }))
    push(client, { kind: "event", event: ev({ id: "e3", frame: 31, clock: "10:31" }) })
    for (let n = 31; n <= 40; n++) push(client, { kind: "frame", frame: frame(n) })
    expect(within(card()!).getByTestId("card-casual").textContent).toMatch(/1\/2 passes$/)
    // Its moments: tapping one freezes on that frame.
    await userEvent.click(within(card()!).getByRole("button", { name: /10:12/ }))
    expect(shown().dataset.frame).toBe("12")
    expect(within(card()!).getByTestId("card-casual").textContent).toMatch(/1\/1 passes$/)
    // Back to live: everything up to now.
    await userEvent.click(screen.getByRole("button", { name: "Play" }))
    expect(within(card()!).getByTestId("card-casual").textContent).toMatch(/2\/3 passes$/)
  })

  it("analyst mode shows the numbers", async () => {
    const client = await watching()
    await userEvent.selectOptions(screen.getByLabelText("Favourite player"), "p-lar-09")
    await userEvent.selectOptions(screen.getByLabelText("mode"), "analyst")
    for (let n = 1; n <= 30; n++) push(client, { kind: "frame", frame: frame(n) })
    expect(document.querySelector('[data-stat="cardDistance"]')!.textContent).toBe("0.01 km")
    expect(document.querySelector('[data-stat="cardTop"]')!.textContent).toBe("18.0 km/h")
  })

  it("is remembered for the next visit, and the pause offers a question about them", async () => {
    localStorage.setItem(PLAYER_KEY, "p-lar-09")
    const client = await watching()
    expect((screen.getByLabelText("Favourite player") as HTMLSelectElement).value).toBe("p-lar-09")
    for (let n = 1; n <= 20; n++) push(client, { kind: "frame", frame: frame(n) })
    await userEvent.click(screen.getByRole("button", { name: "Pause" }))
    const ask = await screen.findByRole("region", { name: "Ask" })
    await userEvent.click(within(ask).getByRole("button", { name: "What should Feseo Wylford do here?" }))
    expect(client.asks[0]!.req).toMatchObject({ frame: 20, question: "What should Feseo Wylford do here?", chip_id: null })
  })

  it("no favourite: no card, no extra question", async () => {
    const client = await watching()
    for (let n = 1; n <= 20; n++) push(client, { kind: "frame", frame: frame(n) })
    await userEvent.click(screen.getByRole("button", { name: "Pause" }))
    await screen.findByRole("region", { name: "Ask" })
    expect(card()).toBeNull()
    expect(screen.queryByRole("button", { name: /What should/ })).toBeNull()
    expect(shown().dataset.focus).toBeUndefined()
  })

  it("in 3D the favourite is the player followed, and the card sits over the stage", async () => {
    localStorage.setItem(PLAYER_KEY, "p-nor-01")
    const client = await watching()
    await userEvent.click(screen.getByRole("button", { name: "3D" }))
    for (let n = 1; n <= 5; n++) push(client, { kind: "frame", frame: frame(n) })
    expect(screen.getByTestId("stage").dataset.followed).toBe("p-nor-01")
    expect(within(card()!).getByRole("heading", { name: "Datan Drenussen" })).toBeTruthy()
    await userEvent.selectOptions(screen.getByLabelText("Favourite player"), "p-lar-09")
    expect(screen.getByTestId("stage").dataset.followed).toBe("p-lar-09")
  })
})
