import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename } from "node:path"
import { describe, expect, it } from "vitest"

describe("test temp folder", () => {
  it("is a fresh folder for this run (vitest.tmp.ts deletes it afterwards)", () => {
    expect(basename(tmpdir())).toMatch(/^touchline-test-/)
    expect(existsSync(tmpdir())).toBe(true)
  })
})
