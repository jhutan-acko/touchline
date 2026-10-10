import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import type { RunManifest } from "@touchline/sim"
import { describe, expect, it } from "vitest"
import { replayManager } from "../src/replay.js"
import { rulesManager } from "../src/rules.js"
import { DECISIONS_FILE, readDecisions, writeManaged } from "../src/write.js"
import { leagueConfig, models, root, xt } from "./helpers.js"

const cfg = { ...leagueConfig(11), managed: undefined }
const dir = mkdtempSync(join(tmpdir(), "managed-"))
const manifest = Effect.runSync(writeManaged(cfg, { home: rulesManager, away: rulesManager }, join(dir, "a"), { models, xt }))
const manifestOf = (d: string) => JSON.parse(readFileSync(join(d, "manifest.json"), "utf8")) as RunManifest

describe("a managed match's run folder", () => {
  it("holds the usual files plus decisions.jsonl, all hashed, and names its managers", () => {
    for (const f of ["meta.json", "event.jsonl", "tracking.jsonl", "domain.jsonl", "spadl.csv", DECISIONS_FILE, "manifest.json"]) expect(existsSync(join(dir, "a", f)), f).toBe(true)
    const decisions = readDecisions(join(dir, "a", DECISIONS_FILE))
    expect(manifest.managers).toEqual({ home: "rules", away: "rules", decisions: decisions.length })
    expect(manifest.outputs[DECISIONS_FILE]).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(manifestOf(join(dir, "a"))).toEqual(manifest)
  })
  it("has no scenario script: a script forcing outcomes would distort the decisions", () => {
    const scripted = { ...cfg, script: { name: "x", entries: [{ window: [0, 10] as [number, number], team: "home" as const, effect: "goal" as const, count: 1 }] } }
    expect(() => Effect.runSync(writeManaged(scripted, { home: rulesManager }, join(dir, "scripted"), { models, xt }))).toThrow("a managed match has no scenario script")
  })
  it("replays from its decision log into identical files", () => {
    const replay = replayManager(readDecisions(join(dir, "a", DECISIONS_FILE)))
    const again = Effect.runSync(writeManaged(cfg, { home: replay, away: replay }, join(dir, "b"), { models, xt }))
    expect(again.outputs).toEqual(manifest.outputs)
    expect(again.managers).toEqual({ ...manifest.managers, home: "replay", away: "replay" })
  })
})

describe("pnpm manage", () => {
  const manage = (...args: string[]) => spawnSync("pnpm", ["-s", "manage", ...args], { cwd: root, encoding: "utf8" })
  it("writes a match with a rules manager for one team and none for the other, then replays it", () => {
    const out = join(dir, "cli")
    const r = manage("--seed", "11", "--home-manager", "rules", "--away-manager", "none", "--out", out)
    expect(r.status, r.stderr).toBe(0)
    expect(manifestOf(out).managers!.away).toBeNull()
    const again = join(dir, "cli-replay")
    expect(manage("--seed", "11", "--replay", join(out, DECISIONS_FILE), "--out", again).status).toBe(0)
    expect(manifestOf(again).outputs["domain.jsonl"]).toBe(manifestOf(out).outputs["domain.jsonl"])
  })
  it("refuses a bad command line with a one-line message", () => {
    const same = manage("--home", "ironmoor", "--away", "ironmoor")
    // pnpm echoes the commands it runs on stderr first; the message is the last line.
    expect([same.status, same.stderr.trim().split("\n").at(-1)]).toEqual([2, "--home and --away must be different clubs"])
    const missing = manage("--replay", join(dir, "nope.jsonl"))
    expect(missing.status).toBe(2)
    expect(missing.stderr).toContain("no decision log at")
  })
})
