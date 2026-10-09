import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { Effect, Exit, Schema } from "effect"
import { beforeAll, describe, expect, it } from "vitest"
import { WhatIfClip } from "@touchline/rpc"
import { decodeMomentTrace, type DomainEvent, type MomentTrace } from "@touchline/schema"
import { makeEvidence } from "../src/evidence.js"
import { readMatch, type LibraryMatch } from "../src/library.js"
import { betterMomentId } from "../src/betterpass.js"
import { activeWorkers, betterOptionEvents, computeClip, computeInWorker, makeWhatIf, readWhatIfs, runWorker, scanCandidates, scanChunk, scanPasses, SCAN_MIN_OPTIONS, WHATIF_FILE, WHATIF_SEEDS, writeWhatIfs } from "../src/whatif.js"
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
    const written = writeWhatIfs(lib.run, [pass.id, "nope"], [], (l) => logs.push(l))
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
    const ev = makeEvidence(new Map([[MATCH_ID, lm]]), w)
    const cue = `mo-${goal.id}-casual.en.neutral`
    expect((await Effect.runPromise(ev.evidence(MATCH_ID, cue))).what_if).toBeNull()
    const traces = original.trim().split("\n").map((l) => JSON.parse(l) as MomentTrace)
    const claim = { kind: "better_option", sentence: 0, quote: "", metric_id: null, subject: null, value: null, at_frame: pass.frame_id, window_s: null, event_id: pass.id, receiver_id: "p-x" }
    traces[0] = { ...traces[0]!, analysis: { ...traces[0]!.analysis, claims: [...traces[0]!.analysis.claims, claim as never] } }
    writeFileSync(path, traces.map((t) => JSON.stringify(t) + "\n").join(""))
    try {
      const fresh = makeEvidence(new Map([[MATCH_ID, lm]]), w)
      expect((await Effect.runPromise(fresh.evidence(MATCH_ID, cue))).what_if).toEqual({ event_id: pass.id, verdict: "better_option_found" })
      const unknown = makeEvidence(new Map([[MATCH_ID, lm]]), { verdict: () => null, known: () => null })
      expect((await Effect.runPromise(unknown.evidence(MATCH_ID, cue))).what_if).toEqual({ event_id: pass.id, verdict: null })
    } finally {
      writeFileSync(path, original)
    }
  }, 60_000)
})

describe("the better-pass scan", () => {
  it("looks at the passes with options on record, explains those played in the opponents' half, and keeps the verified better ones", async () => {
    const all = scanCandidates(lib.run)
    const events = readFileSync(join(lib.run, "domain.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as DomainEvent)
    for (const id of all) expect((events.find((e) => e.id === id)!.attrs.options as unknown[]).length).toBeGreaterThanOrEqual(SCAN_MIN_OPTIONS)
    const some = all.slice(200, 212)
    const one = scanChunk(lib.run, some)
    expect(one.examined).toBeGreaterThan(0)
    expect(one.examined).toBeLessThanOrEqual(some.length)
    for (const c of one.clips) {
      expect(c.verdict).toBe("better_option_found")
      expect(c).toEqual(computeClip(lib.run, c.event_id))
    }
    // Spread over threads, the same answer.
    expect(await scanPasses(lib.run, { workers: 3, eventIds: some })).toEqual({ clips: one.clips, examined: one.examined })
  }, 300_000)
})

describe("better-pass moments", () => {
  const better = (): WhatIfClip => ({ ...cachedClip(), shots: { played: 1, better: 6 } })
  const lmWith = (clips: WhatIfClip[]) => {
    mkdirSync(join(lib.run, "agents"), { recursive: true })
    writeFileSync(join(lib.run, "agents", WHATIF_FILE), clips.map((c) => JSON.stringify(c) + "\n").join(""))
    return readMatch(lib.run, league)
  }

  it("become a verified cue per mode and language, shown once the clip's real play has run", () => {
    const lm = lmWith([better(), { ...computed, event_id: "other", verdict: "played_pass_was_best" }])
    const cues = lm.cues.filter((c) => c.moment_id === betterMomentId(pass.id))
    expect(cues.map((c) => `${c.segment.mode}.${c.segment.lang}`).sort()).toEqual(["analyst.en", "analyst.es", "analyst.hi", "casual.en", "casual.es", "casual.hi"])
    const en = cues.find((c) => c.segment.mode === "casual" && c.segment.lang === "en")!
    expect(en).toMatchObject({ verified: true, evidence: [pass.id], display: { slot: "lower_third", template: "better_pass" }, anchor: { frame_from: pass.frame_id, frame_to: computed.real.at(-1)!.frame } })
    expect(en.text!.headline).toBe("A better pass was on")
    expect(en.text!.body).toMatch(/led to a shot in 6 of 20 re-runs, against 1 of 20\./)
    expect(en.text!.body).toMatch(/^#\d+ \w+/)
    expect(lm.cues.some((c) => c.moment_id === betterMomentId("other"))).toBe(false) // only verified better passes
    const noShots = lmWith([{ ...better(), shots: { played: 2, better: 2 } }]).cues.find((c) => c.cue_id.endsWith("casual.en.neutral") && c.moment_id === betterMomentId(pass.id))!
    expect(noShots.text!.body).toMatch(/verified better over 20 re-runs \(expected goals and threat \+0\.20\)/)
  })

  it("explain themselves with the re-simulation's numbers and offer the split", async () => {
    const lm = lmWith([better()])
    const ev = makeEvidence(new Map([[MATCH_ID, lm]]))
    const e = await Effect.runPromise(ev.evidence(MATCH_ID, `${betterMomentId(pass.id)}-casual.es.neutral`))
    expect(e.cause).toBe("A better pass was on")
    expect(e.claims.map((c) => c.quote)).toEqual(["1 of 20 vs 6 of 20", "0 of 20 vs 2 of 20", "+0.20 ± 0.05"])
    expect(e.events.map((x) => x.id)).toEqual([pass.id])
    expect(e.what_if).toEqual({ event_id: pass.id, verdict: "better_option_found" })
    expect(e.model).toBeNull()
  }, 60_000)
})

describe("what-if workers", () => {
  it("fail at once when a worker exits without answering, instead of waiting out the time limit", async () => {
    const t0 = Date.now()
    await expect(runWorker(new URL("./workers/silent.mjs", import.meta.url), {}, 60_000, [])).rejects.toThrow(/exited without an answer/)
    expect(Date.now() - t0).toBeLessThan(10_000)
  })

  it("stop every thread of a scan when one of them fails", async () => {
    const some = scanCandidates(lib.run).slice(200, 206)
    await expect(scanPasses(lib.run, { workers: 3, eventIds: ["nope", ...some] })).rejects.toThrow(/nope/)
    for (let i = 0; i < 50 && activeWorkers() > 0; i++) await new Promise((r) => setTimeout(r, 100))
    expect(activeWorkers()).toBe(0)
  }, 120_000)

  it("compute at most a few clips at once, however many viewers ask", async () => {
    const passes = readFileSync(join(lib.run, "domain.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as DomainEvent).filter((e) => e.type === "pass").slice(0, 4)
    let running = 0
    let most = 0
    const compute = async (_dir: string, id: string) => {
      most = Math.max(most, ++running)
      await new Promise((r) => setTimeout(r, 50))
      running--
      return { ...computed, event_id: id }
    }
    mkdirSync(join(lib.run, "agents"), { recursive: true })
    writeFileSync(join(lib.run, "agents", WHATIF_FILE), "")
    const w = makeWhatIf(new Map([[MATCH_ID, readMatch(lib.run, league)]]), { compute, maxConcurrent: 2 })
    await Promise.all(passes.map((p) => Effect.runPromise(w.clip(MATCH_ID, p.id, 10_000_000))))
    expect(most).toBe(2)
  })
})
