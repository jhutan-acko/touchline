import { execFileSync, spawnSync } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { CliError, integer, isoTime, oneOf, parseCli, positiveInteger } from "../src/args.js"

const spec = {
  seed: { default: "1", check: integer(0, 4294967295), help: "match seed" },
  kickoff: { default: "2026-10-18T14:00:00.000Z", check: isoTime, help: "kickoff time (UTC, ISO 8601)" },
  fps: { default: "10", check: oneOf(["10", "25"]), help: "frames per second" },
  matches: { default: "8", check: positiveInteger, help: "matches per evaluation" },
  out: { default: "out", help: "output folder" }
}

describe("command-line options", () => {
  it("fills defaults and normalises values", () => {
    expect(parseCli([], spec)).toEqual({ seed: "1", kickoff: "2026-10-18T14:00:00.000Z", fps: "10", matches: "8", out: "out" })
    expect(parseCli(["--seed", "7", "--kickoff", "2026-10-19T15:30:00Z"], spec)).toMatchObject({ seed: "7", kickoff: "2026-10-19T15:30:00.000Z" })
  })
  it("rejects unknown options, naming them", () => {
    expect(() => parseCli(["--speed", "4"], spec)).toThrow(CliError)
    expect(() => parseCli(["--speed", "4"], spec)).toThrow(/--speed/)
  })
  it("rejects an option given without a value", () => {
    expect(() => parseCli(["--seed"], spec)).toThrow(/--seed/)
    expect(() => parseCli(["--seed", "--out", "x"], spec)).toThrow(/--seed/)
  })
  it("rejects malformed values with a message, not a stack trace", () => {
    expect(() => parseCli(["--kickoff", "tomorrow"], spec)).toThrow(/--kickoff must be an ISO 8601 UTC time/)
    expect(() => parseCli(["--kickoff", "2026-13-45T99:00:00Z"], spec)).toThrow(/--kickoff/)
    expect(() => parseCli(["--seed=-1"], spec)).toThrow(/--seed must be an integer between 0 and 4294967295/)
    expect(() => parseCli(["--seed", "-1"], spec)).toThrow(/--seed/)
    expect(() => parseCli(["--seed", "1.5"], spec)).toThrow(/--seed/)
    expect(() => parseCli(["--fps", "30"], spec)).toThrow(/--fps must be one of 10, 25/)
    expect(() => parseCli(["--matches", "0"], spec)).toThrow(/--matches must be a positive integer/)
    expect(() => parseCli(["--matches", "abc"], spec)).toThrow(/--matches/)
  })
  it("rejects stray positional arguments", () => {
    expect(() => parseCli(["ironmoor"], spec)).toThrow(/ironmoor/)
  })
})

describe("sim CLI", () => {
  const pkg = join(dirname(fileURLToPath(import.meta.url)), "..")
  const tsx = join(pkg, "../../node_modules/.bin/tsx")
  it("exits 2 with a one-line message on a bad option", () => {
    const r = spawnSync(tsx, ["src/cli.ts", "--kickoff", "nonsense"], { cwd: pkg, encoding: "utf8" })
    expect(r.status).toBe(2)
    expect(r.stderr.trim()).toMatch(/^--kickoff must be an ISO 8601 UTC time/)
    expect(r.stderr).not.toMatch(/at .*\.ts:\d+/)
  })
  it("prints the options on --help", () => {
    const out = execFileSync(tsx, ["src/cli.ts", "--help"], { cwd: pkg, encoding: "utf8" })
    expect(out).toMatch(/--seed/)
    expect(out).toMatch(/--params/)
  })
})
