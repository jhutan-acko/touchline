import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const pkg = join(dirname(fileURLToPath(import.meta.url)), "..")
const tsx = join(pkg, "../../node_modules/.bin/tsx")
const run = (script: string, args: string[]) => spawnSync(tsx, [script, ...args], { cwd: pkg, encoding: "utf8" })

describe("calibration command lines", () => {
  it("the tuner rejects a match count that is not a positive integer", () => {
    // --out points at a scratch file so a regression can never overwrite the committed parameters.
    const out = join(mkdtempSync(join(tmpdir(), "touchline-cli-")), "params.json")
    for (const m of ["0", "abc"]) {
      const r = run("src/cli.ts", ["--matches", m, "--out", out])
      expect(r.status, m).toBe(2)
      expect(r.stderr.trim()).toBe("--matches must be a positive integer")
      expect(existsSync(out)).toBe(false)
    }
  })
  it("the realism report rejects a params file it cannot use, without a stack trace", () => {
    const r = run("src/realism.ts", ["--params", "no-such-file.json"])
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/^Cannot use params file no-such-file\.json/)
    expect(r.stderr).not.toMatch(/at .*\.ts:\d+/)
  })
})
