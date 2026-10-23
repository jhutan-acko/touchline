/**
 * The frame summary (pause-and-ask): what the agents are told about a paused frame. The players where they stand, who
 * has the ball and his options, who is pressing him, the events of the last seconds and the better option the latest
 * pass missed. Built from the re-simulated match state at the frame and the run's events, and never from anything
 * after it: an event is recent only once it has fully happened by the frame (a pass once it has arrived).
 */
import type { Session as AdvisorSession } from "@touchline/advisor"
import type { DomainEvent, FrameSummary } from "@touchline/schema"
import { dist, matchClock, passOptions, type MatchState, type Side } from "@touchline/sim-core"

/** Seconds of events the summary looks back. */
export const RECENT_S = 10
/** Pass options listed, at most. */
export const MAX_PASS_OPTIONS = 5
/** Opponents this close (m) to the ball holder press him. */
export const PRESS_RADIUS_M = 5

const r2 = (v: number) => Math.round(v * 100) / 100 || 0

/** The tick by which an event has fully happened (a pass is stamped at its release and ends when it arrives). */
const happened = (e: DomainEvent) => Math.max(e.frame_id, e.frame_id_end ?? e.frame_id)

/** The receivers open to the player on the ball, each once at its best value, best first. */
const options = (s: MatchState) => {
  const seen = new Set<string>()
  return passOptions(s).filter((o) => !seen.has(o.receiverId) && (seen.add(o.receiverId), true))
}

const holderOf = (s: MatchState) => (s.possession.kind === "owned" ? s.players.find((p) => p.id === (s.possession as { playerId: string }).playerId) ?? null : null)

/** The side on the ball: the holder's, the passer's while a ball is in flight, the last toucher's while it is loose. */
const sideOf = (s: MatchState): Side | null => {
  const holder = holderOf(s)
  if (holder) return holder.side
  if (s.possession.kind === "in_flight") return s.possession.flight.side
  if (s.possession.kind === "loose") return s.lastTouch?.side ?? null
  return null
}

/**
 * The pass's better option on paper: its options re-scored at its own decision (the state before its frame, as
 * explainPass), and a different receiver with a higher value than the best to the receiver it was meant for.
 */
const missedOption = (session: AdvisorSession, pass: DomainEvent): FrameSummary["missed_option"] => {
  const playedTo = pass.attrs.intended_receiver_id
  if (pass.player_id === null || typeof playedTo !== "string") return null
  const state = session.stateAt(pass.frame_id - 1)
  if (holderOf(state)?.id !== pass.player_id) return null
  const open = options(state)
  const played = open.find((o) => o.receiverId === playedTo)
  const best = open[0]
  if (!played || !best || best.receiverId === playedTo || !(best.value > played.value)) return null
  return { event_id: pass.id, passer_id: pass.player_id, played_to: playedTo, better_to: best.receiverId }
}

/** What happened at `frame` (a tick: the state after its step), as of that frame. Throws AdvisorError past full time. */
export const frameSummary = (session: AdvisorSession, matchId: string, frame: number): FrameSummary => {
  const cfg = session.cfg
  const since = frame - Math.round(RECENT_S / cfg.dt)
  const events = session.events.filter((e) => e.frame_id >= since && happened(e) <= frame)
    // Newest first; events of one frame newest first too (the run lists them in the order they happened).
    .reverse()
    .sort((a, b) => b.frame_id - a.frame_id)
  const teamSide = (teamId: string | null): Side | null => (teamId === cfg.home.id ? "home" : teamId === cfg.away.id ? "away" : null)
  const newestPass = (side: Side) => events.find((e) => e.type === "pass" && teamSide(e.team_id) === side) ?? null
  const passes = (["home", "away"] as const).map(newestPass).filter((e) => e !== null)
  // One run of the match for every state needed (a scripted match is replayed from kick-off for each state otherwise).
  session.prefetch([frame, ...passes.map((e) => e.frame_id - 1)])
  const state = session.stateAt(frame)
  const named = new Map([...cfg.home.starters, ...(cfg.home.bench ?? []), ...cfg.away.starters, ...(cfg.away.bench ?? [])].map((p) => [p.id, (p as { name?: string }).name ?? p.id]))
  const onPitch = state.players.filter((p) => !p.sentOff)
  const holder = holderOf(state)
  const side = sideOf(state)
  const pass = side ? newestPass(side) : null
  return {
    match_id: matchId,
    frame,
    clock: matchClock(state.period, state.periodTick, cfg.dt),
    ball_holder: holder?.id ?? null,
    side_in_possession: side,
    players: onPitch.map((p) => ({ id: p.id, name: named.get(p.id) ?? p.id, side: p.side, role: p.role, x: r2(p.pos.x), y: r2(p.pos.y) })),
    pass_options: holder ? options(state).slice(0, MAX_PASS_OPTIONS).map((o) => ({ receiver_id: o.receiverId, xpass: r2(o.xpass), value: Math.round(o.value * 1e4) / 1e4 || 0 })) : [],
    pressers: holder ? onPitch.filter((p) => p.side !== holder.side && dist(p.pos, holder.pos) <= PRESS_RADIUS_M).map((p) => p.id) : [],
    recent: events.map((e) => ({
      event_id: e.id,
      frame: e.frame_id,
      type: e.type,
      player_id: e.player_id,
      receiver_id: typeof e.attrs.receiver_id === "string" ? e.attrs.receiver_id : null
    })),
    missed_option: pass ? missedOption(session, pass) : null
  }
}
