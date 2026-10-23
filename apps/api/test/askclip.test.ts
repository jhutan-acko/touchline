import { readFileSync } from "node:fs"
import { join } from "node:path"
import { Schema } from "effect"
import { beforeAll, describe, expect, it } from "vitest"
import { CLIP_BEFORE_S, MIN_GAIN, type Session } from "@touchline/advisor"
import { AskClip } from "@touchline/rpc"
import { FrameSummary, type AskIntent, type DomainEvent } from "@touchline/schema"
import { passOptions } from "@touchline/sim-core"
import { frameSummary } from "../src/askframe.js"
import { ASK_SEEDS, askWhatIfOf, computeAskClip, forkFrameOf } from "../src/askclip.js"
import { askClipInWorker, rebuild, summaryInWorker } from "../src/whatif.js"
import { makeLibrary, MATCH_ID, type TestLibrary } from "./fixture.js"

let lib: TestLibrary
let session: Session
let p: DomainEvent
let forkFrame: number
let pausedFrame: number
let second: string
let clip: AskClip
const fps = 10

beforeAll(async () => {
  lib = await makeLibrary()
  const events = readFileSync(join(lib.run, "domain.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as DomainEvent)
  const end = events.reduce((m, e) => Math.max(m, e.frame_id), 0)
  session = rebuild(lib.run).session
  // The first pass (after the opening minute) with a second receiver open and 100 frames left after it.
  p = events.find((e) => {
    if (e.type !== "pass" || e.player_id === null || e.frame_id < 600 || e.frame_id + 100 >= end) return false
    const receivers = new Set(passOptions(session.stateAt(e.frame_id - 1)).map((o) => o.receiverId))
    return receivers.size >= 2
  })!
  forkFrame = p.frame_id
  pausedFrame = p.frame_id + 50
  second = [...new Set(passOptions(session.stateAt(forkFrame - 1)).map((o) => o.receiverId))][1]!
  // Every state the summaries below need, in one replay of the (scripted) match.
  session.prefetch(Array.from({ length: pausedFrame - forkFrame + 142 }, (_, i) => forkFrame - 141 + i))
  clip = computeAskClip(lib.run, { forkFrame, pausedFrame, intervention: { kind: "pass_to", player_id: p.player_id!, receiver_id: second } })
}, 180_000)

describe("the what-if at any frame", () => {
  it("never shows real frames after the paused frame", () => {
    expect(Schema.decodeUnknownSync(AskClip)(clip)).toEqual(clip)
    expect(clip.real.at(-1)!.frame).toBeLessThanOrEqual(pausedFrame)
    expect(clip.real.at(-1)!.frame).toBe(pausedFrame)
    expect(clip.real[0]!.frame).toBe(forkFrame - CLIP_BEFORE_S * fps)
    expect(clip.real.map((f) => f.frame)).toEqual(Array.from({ length: clip.real.length }, (_, i) => forkFrame - CLIP_BEFORE_S * fps + i))
    expect(clip).toMatchObject({ fork_frame: forkFrame, paused_frame: pausedFrame, fps })
    expect(clip.clip_id).toMatch(new RegExp(`^${forkFrame}-${pausedFrame}-[0-9a-f]+$`))
  })

  it("runs ASK_SEEDS seeds and gives a verdict by the shared rule", () => {
    expect(clip.seeds).toBe(ASK_SEEDS)
    expect(clip.seeds).toBe(20)
    expect(["played_pass_was_best", "better_option_found", "not_verified"]).toContain(clip.verdict)
    if (clip.verdict === "better_option_found") expect(clip.gain!.mean).toBeGreaterThanOrEqual(MIN_GAIN)
    if (clip.verdict === "played_pass_was_best") expect(clip.gain!.mean).toBeLessThanOrEqual(-MIN_GAIN)
    expect(clip.variant).not.toBeNull()
    expect(clip.gain).not.toBeNull()
    expect(clip.typical_seed).toBeGreaterThanOrEqual(0)
    expect(clip.shots!.played + clip.shots!.alt).toBeLessThanOrEqual(2 * ASK_SEEDS)
    // The variant: the same frames up to the fork, then the typical seed's full horizon.
    const lead = clip.real.findIndex((f) => f.frame === forkFrame)
    expect(clip.variant!.slice(0, lead)).toEqual(clip.real.slice(0, lead))
    expect(clip.variant!.at(-1)!.frame).toBe(forkFrame + 10 * fps - 1)
    expect(askWhatIfOf(clip)).toEqual({ intervention: clip.intervention, fork_frame: forkFrame, verdict: clip.verdict, seeds: clip.seeds, shots: clip.shots, goals: clip.goals, gain: clip.gain })
  })

  it("is deterministic", () => {
    expect(computeAskClip(lib.run, { forkFrame, pausedFrame, intervention: { kind: "pass_to", player_id: p.player_id!, receiver_id: second } })).toEqual(clip)
  }, 120_000)

  it("returns variant null for an intervention that cannot apply", () => {
    const passer = session.stateAt(forkFrame - 1).players.find((q) => q.id === p.player_id)!
    const opponent = session.stateAt(forkFrame - 1).players.find((q) => q.side !== passer.side)!
    const bad = computeAskClip(lib.run, { forkFrame, pausedFrame, intervention: { kind: "pass_to", player_id: p.player_id!, receiver_id: opponent.id } })
    expect(bad).toMatchObject({ variant: null, verdict: "not_verified", typical_seed: null, shots: null, goals: null, gain: null })
    expect(bad.real).toEqual(clip.real)
    expect(bad.clip_id).not.toBe(clip.clip_id)
    expect(askWhatIfOf(bad)).toBeNull()
  }, 120_000)

  it("summarises only what has happened by the frame", () => {
    const s = frameSummary(session, MATCH_ID, pausedFrame)
    expect(Schema.decodeUnknownSync(FrameSummary)(s)).toEqual(s)
    expect(s).toMatchObject({ match_id: MATCH_ID, frame: pausedFrame })
    expect(s.recent.length).toBeGreaterThan(0)
    for (const r of s.recent) {
      expect(r.frame).toBeLessThanOrEqual(pausedFrame)
      expect(r.frame).toBeGreaterThanOrEqual(pausedFrame - 10 * fps)
    }
    expect(s.recent.map((r) => r.frame)).toEqual([...s.recent.map((r) => r.frame)].sort((a, b) => b - a))
    expect(s.pass_options.length).toBeLessThanOrEqual(5)
    const side = (id: string) => s.players.find((q) => q.id === id)!.side
    if (s.ball_holder === null) {
      expect(s.pressers).toEqual([])
      expect(s.pass_options).toEqual([])
    } else for (const id of s.pressers) expect(side(id)).not.toBe(side(s.ball_holder))
    if (s.missed_option) {
      const r = s.recent.find((x) => x.event_id === s.missed_option!.event_id)!
      expect(r.type).toBe("pass")
      expect(s.missed_option.better_to).not.toBe(s.missed_option.played_to)
    }
    // Every frame of a long stretch: never a recent event or missed option after the frame.
    for (let f = forkFrame - 30; f <= pausedFrame; f += 10) {
      const t = frameSummary(session, MATCH_ID, f)
      expect(t.recent.every((r) => r.frame <= f)).toBe(true)
      if (t.missed_option) expect(t.recent.some((r) => r.event_id === t.missed_option!.event_id)).toBe(true)
    }
  }, 120_000)

  it("forks at the named pass when it is in the summary, else at the paused frame", () => {
    const s = frameSummary(session, MATCH_ID, pausedFrame)
    const intent = (fork: string | null): AskIntent => ({ kind: "what_if", subject_id: null, fork_event_id: fork, intervention: { kind: "pass_to", player_id: "x", receiver_id: "y" }, reason: null })
    const r = s.recent[s.recent.length - 1]!
    expect(forkFrameOf(s, intent(r.event_id))).toBe(r.frame)
    expect(forkFrameOf(s, intent("nope"))).toBe(pausedFrame)
    expect(forkFrameOf(s, intent(null))).toBe(pausedFrame)
  })

  it("computes the summary and the clip in a worker thread", async () => {
    expect(await summaryInWorker(lib.run, pausedFrame, 60_000)).toEqual(frameSummary(session, MATCH_ID, pausedFrame))
    expect(await askClipInWorker(lib.run, { forkFrame, pausedFrame, intervention: clip.intervention }, 60_000)).toEqual(clip)
  }, 180_000)
})
