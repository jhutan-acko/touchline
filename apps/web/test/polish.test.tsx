import { act, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { PitchFrame } from "@touchline/rpc"
import { App } from "../src/App.js"
import { ASK_DRAWER_ATTR, spaceToggles } from "../src/keys.js"
import { MatchList, scenarioTitle } from "../src/MatchList.js"
import type { Stage3DProps } from "../src/view3d/Stage3D.js"
import { hasWebGL } from "../src/view3d/webgl.js"
import { initialView, VIEW_KEY, Watch, type StageView } from "../src/Watch.js"
import { HINT_KEY, HINT_MS } from "../src/WatchBar.js"
import { fakeClient, INFO, MATCH } from "./fake-client.js"

vi.mock("../src/view3d/webgl.js", () => ({ hasWebGL: vi.fn(() => true) }))
vi.mock("../src/view3d/Stage3D.js", () => ({ Stage3D: (_: Stage3DProps) => <div data-testid="stage" /> }))

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem(HINT_KEY, "1")
  vi.mocked(hasWebGL).mockReturnValue(true)
})
afterEach(() => vi.useRealTimers())

const frame = (n: number): PitchFrame => ({ frame: n, period: "first_half", clock: "10:00.00", ball: { x: 0, y: 0, z: 0 }, home: [], away: [] })
const watching = async () => {
  const client = fakeClient()
  render(<App client={client} />)
  await userEvent.click(await screen.findByRole("button", { name: "Watch" }))
  for (let n = 1; n <= 20; n++) act(() => client.push({ kind: "frame", frame: frame(n) }))
  return client
}
const frozen = () => screen.getByRole("button", { name: /^(Play|Pause)$/ }).getAttribute("aria-pressed") === "true"

describe("the space bar on the Watch page", () => {
  const key = (target: EventTarget | null, o: Partial<KeyboardEvent> = {}) => ({ key: " ", repeat: false, altKey: false, ctrlKey: false, metaKey: false, target, ...o })

  it("toggles from anywhere but a field being typed in or the Ask drawer", () => {
    const button = document.createElement("button")
    const link = document.createElement("a")
    expect(spaceToggles(key(button))).toBe(true)
    expect(spaceToggles(key(link))).toBe(true)
    expect(spaceToggles(key(document.body))).toBe(true)
    expect(spaceToggles(key(window))).toBe(true)
    for (const tag of ["input", "textarea", "select"]) expect(spaceToggles(key(document.createElement(tag)))).toBe(false)
    const editable = document.createElement("div")
    editable.contentEditable = "true"
    document.body.append(editable)
    expect(spaceToggles(key(editable))).toBe(editable.isContentEditable ? false : true)
    editable.remove()
    const drawer = document.createElement("aside")
    drawer.setAttribute(ASK_DRAWER_ATTR, "")
    const chip = document.createElement("button")
    drawer.append(chip)
    expect(spaceToggles(key(chip))).toBe(false)
    expect(spaceToggles(key(button, { key: "Enter" }))).toBe(false)
    expect(spaceToggles(key(button, { repeat: true }))).toBe(false)
    expect(spaceToggles(key(button, { ctrlKey: true }))).toBe(false)
  })

  it("pauses even with a button focused, without pressing that button", async () => {
    localStorage.setItem(VIEW_KEY, "2d")
    await watching()
    const twoD = screen.getByRole("button", { name: "2D" })
    const threeD = screen.getByRole("button", { name: "3D" })
    threeD.focus()
    await userEvent.keyboard(" ")
    expect(frozen()).toBe(true)
    expect(twoD.getAttribute("aria-pressed")).toBe("true") // the focused 3D button was not pressed
    expect(screen.getByRole("region", { name: "Ask" })).toBeTruthy()
    screen.getByRole("button", { name: "Play" }).focus()
    await userEvent.keyboard(" ")
    expect(frozen()).toBe(false) // toggled once, not twice
  })

  it("types a space in the Ask box instead of resuming", async () => {
    localStorage.setItem(VIEW_KEY, "2d")
    await watching()
    await userEvent.keyboard(" ")
    const box = screen.getByRole("textbox", { name: "Ask about this moment" }) as HTMLInputElement
    await userEvent.type(box, "who scored")
    expect(box.value).toBe("who scored")
    expect(frozen()).toBe(true)
  })
})

describe("the match list", () => {
  it("names a match by its scenario and hides the final score until asked", async () => {
    render(<MatchList matches={[MATCH]} lang="en" onWatch={() => {}} />)
    const card = screen.getByRole("listitem")
    expect(within(card).getByRole("heading", { name: "Costly error" })).toBeTruthy()
    expect(within(card).getByText("Northwick Mariners")).toBeTruthy()
    expect(within(card).getByText("Larkspur City")).toBeTruthy()
    expect(card.textContent).not.toMatch(/1–2/)
    await userEvent.click(screen.getByLabelText("Show results"))
    expect(within(card).getByTestId("result").textContent).toBe("1–2")
  })

  it("titles scenarios in the viewer's language, and unknown ones readably", () => {
    expect(scenarioTitle("late_comeback", "en")).toBe("Late comeback")
    expect(scenarioTitle("late_comeback", "es")).toBe("Remontada final")
    expect(scenarioTitle("rainy_derby_day", "en")).toBe("Rainy derby day")
    expect(scenarioTitle(null, "en")).toBeNull()
  })
})

describe("the watch layout", () => {
  it("opens in 3D when the browser can draw it and nothing is saved; a saved 2D wins", async () => {
    expect(initialView(null, true)).toBe("3d")
    expect(initialView(null, false)).toBe("2d")
    expect(initialView("2d", true)).toBe("2d")
    expect(initialView("3d", false)).toBe("2d")
    await watching()
    expect(screen.getByTestId("stage")).toBeTruthy()
    expect(screen.getByRole("button", { name: "3D" }).getAttribute("aria-pressed")).toBe("true")
  })

  it("keeps the fan's controls in one bar and the broadcast tools behind a menu", async () => {
    await watching()
    const bar = screen.getByRole("toolbar", { name: "Match controls" })
    for (const name of [/Back to matches/, "Pause", "2D", "3D", "Broadcast tools"]) expect(within(bar).getByRole("button", { name })).toBeTruthy()
    expect(within(bar).getByLabelText("Speed")).toBeTruthy()
    expect(within(bar).getByLabelText("mode")).toBeTruthy()
    expect(screen.queryByRole("link", { name: "Studio console" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Split screen" })).toBeNull()
    await userEvent.click(within(bar).getByRole("button", { name: "Broadcast tools" }))
    const menu = screen.getByRole("group", { name: "Broadcast tools" })
    expect(within(menu).getAllByRole("link").map((a) => a.textContent?.replace("↗", "").trim())).toEqual(["Studio console", "Graphics output", "Ops view"])
    expect(within(menu).getByRole("button", { name: "Split screen" })).toBeTruthy()
    expect(within(menu).getByLabelText("Auto-show better passes")).toBeTruthy()
  })

  it("opens Ask as a drawer beside the stage, not under it", async () => {
    await watching()
    await userEvent.click(screen.getByRole("button", { name: "Pause" }))
    const ask = screen.getByRole("region", { name: "Ask" })
    const drawer = ask.closest(`[${ASK_DRAWER_ATTR}]`)!
    expect(drawer.tagName).toBe("ASIDE")
    expect(drawer.contains(screen.getByTestId("stage"))).toBe(false)
    expect(drawer.className).toMatch(/lg:w-\[22rem\]/)
    expect(drawer.className).toMatch(/fixed/) // a bottom sheet on phones
  })

  it("gives other components a layer over the stage and a slot under it, with the frozen frame", async () => {
    localStorage.setItem(VIEW_KEY, "2d")
    const client = fakeClient()
    const seen: StageView[] = []
    render(
      <Watch client={client} sessionId="s1" match={INFO} profile={{ mode: "casual", lang: "en", clubs: [] }} onProfile={() => {}} onBack={() => {}}
        overlay={(s) => (seen.push(s), <span>card at {s.at}</span>)} under={(s) => <span>strip {s.frozen ?? "live"}</span>} />
    )
    act(() => client.push({ kind: "frame", frame: frame(5) }))
    expect(within(screen.getByTestId("stage-overlay")).getByText("card at 5")).toBeTruthy()
    expect(within(screen.getByTestId("under-stage")).getByText("strip live")).toBeTruthy()
    await userEvent.click(screen.getByRole("button", { name: "Pause" }))
    act(() => client.push({ kind: "frame", frame: frame(9) }))
    expect(within(screen.getByTestId("under-stage")).getByText("strip 5")).toBeTruthy()
    expect(seen.at(-1)).toMatchObject({ at: 5, frozen: 5, view: "2d" })
  })
})

describe("the first-visit hint", () => {
  it("says how to ask, goes once the viewer pauses, and stays gone next visit", async () => {
    localStorage.removeItem(HINT_KEY)
    await watching()
    expect(screen.getByRole("note").textContent).toMatch(/Press Space or tap Pause to ask about any moment/)
    await userEvent.click(screen.getByRole("button", { name: "Pause" }))
    expect(screen.queryByRole("note")).toBeNull()
    await userEvent.click(screen.getByRole("button", { name: /Back to matches/ }))
    await userEvent.click(await screen.findByRole("button", { name: "Watch" }))
    expect(screen.queryByRole("note")).toBeNull()
  })

  it("dismisses itself after a few seconds", () => {
    localStorage.removeItem(HINT_KEY)
    vi.useFakeTimers()
    render(<Watch client={fakeClient()} sessionId="s1" match={INFO} profile={{ mode: "casual", lang: "hi", clubs: [] }} onProfile={() => {}} onBack={() => {}} />)
    expect(screen.getByRole("note").textContent).toMatch(/Space/)
    act(() => void vi.advanceTimersByTime(HINT_MS))
    expect(screen.queryByRole("note")).toBeNull()
    expect(localStorage.getItem(HINT_KEY)).toBe("1")
  })
})
