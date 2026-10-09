import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { Effect, Exit, Schema } from "effect"
import { beforeAll, describe, expect, it } from "vitest"
import { WhatIfClip } from "@touchline/rpc"
import { decodeMomentTrace, type DomainEvent, type MomentTrace } from "@touchline/schema"
import { makeEvidence } from "../src/evidence.js"
import { readMatch, type LibraryMatch } from "../src/library.js"
import { betterOptionEvents, computeClip, computeInWorker, makeWhatIf, readWhatIfs, WHATIF_FILE, WHATIF_SEEDS, writeWhatIfs } from "../src/whatif.js"
import { league, makeLibrary, MATCH_ID, type TestLibrary } from "./fixture.js"

let lib: TestLibrary
let m: LibraryMatch
let pass: DomainEvent
let computed: WhatIfClip
beforeAll(async () => {
  lib = await makeLibrary()
  m = readMatch(lib.run, league)
  const events = readFileSync(join(lib.run, "domain.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as DomainEvent)
  pass = events.filter((e) => e.type === "pass" && Array.isArray(e.attrs.options) && (e.attrs.options as unknown[]).length >= 3 && e.frame_id > 600)[3]!
  computed = computeClip(lib.run, pass.id)
}, 120_000)

/** A clip that only the cache could have produced. */
const cachedClip = (): WhatIfClip => ({ ...computed, verdict: "better_option_found", better_to: computed.played_to, variant: computed.real, typical_seed: 7, shots: { played: 1, better: 6 }, goals: { played: 0, better: 2 }, gain: { mean: 0.2, se: 0.05 } })
const never = async (): Promise<WhatIfClip> => {
  throw new Error("computed instead of cached")
}
const failure = async <A, E>(e: Effect.Effect<A, E>) => {
  const exit = await Effect.runPromise(Effect.exit(e))
  return Exit.isFailure(exit) ? JSON.stringify(exit.cause) : "succeeded"
}

describe("what-if clips", () => {
  it("rebuild the match and cut the pass as it went, two seconds before to eight after, in the API's frame shape", () => {
    expect(Schema.decodeUnknownSync(WhatIfClip)(computed)).toEqual(computed)
    expect(computed).toMatchObject({ event_id: pass.id, passer_id: pass.player_id, fps: 10, pass_index: 20, seeds: WHATIF_SEEDS })
    expect(computed.real.map((f) => f.frame)).toEqual(Array.from({ length: 100 }, (_, i) => pass.frame_id - 20 + i))
    expect(computed.real[20]!.clock).toMatch(/^\d\d:\d\d\.\d\d$/)
    expect(computed.real[20]!.home[0]).toEqual({ id: computed.real[20]!.home[0]!.id, x: expect.any(Number), y: expect.any(Number) })
    if (computed.verdict !== "better_option_found") expect(computed.variant).toBeNull()
  })

  it("compute the same clip in a worker thread, and give up after the time limit", async () => {
    expect(await computeInWorker(lib.run, pass.id, 60_000)).toEqual(computed)
    await expect(computeInWorker(lib.run, pass.id, 1)).rejects.toThrow(/timed out/)
  }, 120_000)

  it("are cached per run and read back; a pass that cannot be re-simulated is skipped", () => {
    const logs: string[] = []
    const written = writeWhatIfs(lib.run, [pass.id, "nope"], (l) => logs.push(l))
    expect(written).toEqual([computed])
    expect(logs.join("\n")).toMatch(/no what-if for nope/)
    expect(readWhatIfs(lib.run)).toEqual(new Map([[pass.id, computed]]))
  }, 60_000)

  it("name the passes the agents called mistakes, once each", () => {
    const t = lib.traces[0]!
    const claim = { kind: "better_option" as const, sentence: 0, quote: "", metric_id: null, subject: null, value: null, at_frame: pass.frame_id, window_s: null, event_id: pass.id, receiver_id: "p-x" }
    const traces: MomentTrace[] = [t, decodeMomentTrace({ ...t, analysis: { ...t.analysis, claims: [claim] }, draft: { ...t.draft, claims: [claim] } })]
    expect(betterOptionEvents(traces)).toEqual([pass.id])
  })
})

describe("the what-if service", () => {
  const withCache = (clips: WhatIfClip[]) => {
    mkdirSync(join(lib.run, "agents"), { recursive: true })
    writeFileSync(join(lib.run, "agents", WHATIF_FILE), clips.map((c) => JSON.stringify(c) + "\n").join(""))
    return readMatch(lib.run, league)
  }

  it("answers a library match from its cache, cut at the session's frame", async () => {
    const lm = withCache([cachedClip()])
    const w = makeWhatIf(new Map([[MATCH_ID, lm]]), { compute: never })
    const full = await Effect.runPromise(w.clip(MATCH_ID, pass.id, 10_000_000))
    expect(full).toEqual(cachedClip())
    expect(w.verdict(lm, pass.id)).toBe("better_option_found")
    const early = await Effect.runPromise(w.clip(MATCH_ID, pass.id, pass.frame_id + 3))
    expect(early.real.map((f) => f.frame).at(-1)).toBe(pass.frame_id + 3)
    expect(early.variant).toHaveLength(early.real.length)
  })

  it("refuses passes the session has not reached, events that are not passes and unknown matches", async () => {
    const w = makeWhatIf(new Map([[MATCH_ID, withCache([cachedClip()])]]), { compute: never })
    expect(await failure(w.clip(MATCH_ID, pass.id, pass.frame_id - 1))).toMatch(/WhatIfNotAvailable.*not reached yet/)
    const goal = lib.goals[0]!
    expect(await failure(w.clip(MATCH_ID, goal.id, 10_000_000))).toMatch(/not a pass of this match/)
    expect(await failure(w.clip(MATCH_ID, "nope", 10_000_000))).toMatch(/not a pass of this match/)
    expect(await failure(w.clip("nope", pass.id, 10_000_000))).toMatch(/MatchNotFound/)
  })

  it("computes what is not cached once for everyone asking, keeps it, and reports a failure as unavailable", async () => {
    const lm = withCache([])
    let calls = 0
    const w = makeWhatIf(new Map([[MATCH_ID, lm]]), { compute: async () => (calls++, computed) })
    const [a, b] = await Promise.all([Effect.runPromise(w.clip(MATCH_ID, pass.id, 10_000_000)), Effect.runPromise(w.clip(MATCH_ID, pass.id, 10_000_000))])
    expect(a).toEqual(computed)
    expect(b).toEqual(computed)
    expect(calls).toBe(1)
    expect(w.verdict(lm, pass.id)).toBe(computed.verdict)
    const broken = makeWhatIf(new Map([[MATCH_ID, lm]]), { compute: async () => Promise.reject(new Error("timed out after 10 s")) })
    expect(await failure(broken.clip(MATCH_ID, pass.id, 10_000_000))).toMatch(/WhatIfNotAvailable.*timed out after 10 s/)
  })

  it("tells the Why? drawer which pass a cue's better-option claim names, with the verdict once known", async () => {
    const lm = withCache([cachedClip()])
    const w = makeWhatIf(new Map([[MATCH_ID, lm]]), { compute: never })
    const goal = lib.goals[0]!
    const path = join(lib.run, "agents", "traces.jsonl")
    const original = readFileSync(path, "utf8")
    const ev = makeEvidence(new Map([[MATCH_ID, lm]]), w.verdict)
    const cue = `mo-${goal.id}-casual.en.neutral`
    expect((await Effect.runPromise(ev.evidence(MATCH_ID, cue))).what_if).toBeNull()
    const traces = original.trim().split("\n").map((l) => JSON.parse(l) as MomentTrace)
    const claim = { kind: "better_option", sentence: 0, quote: "", metric_id: null, subject: null, value: null, at_frame: pass.frame_id, window_s: null, event_id: pass.id, receiver_id: "p-x" }
    traces[0] = { ...traces[0]!, analysis: { ...traces[0]!.analysis, claims: [...traces[0]!.analysis.claims, claim as never] } }
    writeFileSync(path, traces.map((t) => JSON.stringify(t) + "\n").join(""))
    try {
      const fresh = makeEvidence(new Map([[MATCH_ID, lm]]), w.verdict)
      expect((await Effect.runPromise(fresh.evidence(MATCH_ID, cue))).what_if).toEqual({ event_id: pass.id, verdict: "better_option_found" })
      const unknown = makeEvidence(new Map([[MATCH_ID, lm]]))
      expect((await Effect.runPromise(unknown.evidence(MATCH_ID, cue))).what_if).toEqual({ event_id: pass.id, verdict: null })
    } finally {
      writeFileSync(path, original)
    }
  }, 60_000)
})
