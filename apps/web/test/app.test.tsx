import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
import { App } from "../src/App.js"
import { fakeClient } from "./fake-client.js"

describe("app shell", () => {
  it("lists the library's matches and switches the interface language", async () => {
    render(<App client={fakeClient()} />)
    const card = await screen.findByRole("listitem")
    expect(within(card).getByText("Northwick Mariners")).toBeTruthy()
    // No spoilers: the final score shows only once asked for.
    expect(within(card).queryByText("1–2")).toBeNull()
    await userEvent.click(screen.getByLabelText("Show results"))
    expect(within(card).getByText("1–2")).toBeTruthy()
    await userEvent.selectOptions(screen.getByLabelText("Language"), "hi")
    expect(screen.getByText("मैच")).toBeTruthy()
    expect(within(card).getByRole("button", { name: "देखें" })).toBeTruthy()
  })

  it("says how to fill an empty library", async () => {
    render(<App client={fakeClient({ matches: [] })} />)
    expect(await screen.findByText(/pnpm library/)).toBeTruthy()
  })
})
