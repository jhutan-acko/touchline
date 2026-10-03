import { initMatch, isFinished, step, type DomainEvent } from "../src/index.js"
import { makeConfig } from "../src/testing.js"
const seed = Number(process.argv[2] ?? 1)
const t0 = Date.now()
let s = initMatch(makeConfig(seed))
const events: DomainEvent[] = []
let frames = 0, inPlay = 0
while (!isFinished(s)) { const r = step(s); s = r.state; events.push(...r.events); if (r.frame) { frames++; if (r.frame.ball_in_play) inPlay++ } }
const by = (t: string) => events.filter(e => e.type === t)
const passes = by("pass"); const ok = passes.filter(e => e.outcome === "successful")
const kinds: Record<string, number> = {}; for (const p of passes) { const k = String(p.attrs.kind); kinds[k] = (kinds[k] ?? 0) + 1 }
const exe: Record<string, number> = {}; for (const p of passes) { const k = String(p.attrs.execution); exe[k] = (exe[k] ?? 0) + 1 }
console.log(JSON.stringify({ seed, ms: Date.now() - t0, frames, inPlayPct: +(inPlay / frames * 100).toFixed(1), events: events.length, score: s.score,
  passes: passes.length, completion: +(ok.length / passes.length * 100).toFixed(1), shots: by("shot").length, goals: by("goal").length,
  corners: by("set_piece").filter(e => e.attrs.kind === "corner").length, throwIns: by("set_piece").filter(e => e.attrs.kind === "throw_in").length,
  fouls: by("foul").length, cards: by("card").length, offsides: by("offside").length, tackles: by("tackle").length, takeOns: by("take_on").length,
  carries: by("carry").length, pressures: by("pressure").length, saves: by("keeper_save").length, kinds, exe }))
