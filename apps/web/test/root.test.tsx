import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { Root } from "../src/Root.js"
import { fakeClient } from "./fake-client.js"

afterEach(() => {
  window.location.hash = ""
})

describe("root", () => {
  it("shows the fan app at the start, and for a page it does not know", async () => {
    for (const hash of ["", "#/nope"]) {
      window.location.hash = hash
      const { unmount } = render(<Root client={fakeClient()} />)
      expect(await screen.findByRole("heading", { name: "Matches" })).toBeTruthy()
      unmount()
    }
  })
})
