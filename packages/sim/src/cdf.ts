import type { DomainEvent, Frame, MatchConfig, MatchState, TeamSetup } from "@touchline/sim-core"

export const CDF_VERSION = "0.3.2"
export const REFEREE_ID = "ref-main"
export const ENGINE = { name: "touchline-sim", version: "0.1.0" } as const

const iso = (ms: number): string => new Date(ms).toISOString()

export interface PeriodInfo {
  readonly period: "first_half" | "second_half"
  readonly startMs: number
  readonly endMs: number
  readonly frameIdEnd: number
}

/** Collect period boundaries from the frame stream (first and last frame of each period). */
export const periodsFromFrames = (frames: Iterable<Frame>): PeriodInfo[] => {
  const map = new Map<string, { start: string; end: string; last: number }>()
  for (const f of frames) {
    const m = map.get(f.period)
    if (!m) map.set(f.period, { start: f.timestamp, end: f.timestamp, last: f.frame_id })
    else { m.end = f.timestamp; m.last = f.frame_id }
  }
  return [...map.entries()].map(([period, m]) => ({ period: period as PeriodInfo["period"], startMs: Date.parse(m.start), endMs: Date.parse(m.end), frameIdEnd: m.last }))
}

const team = (t: TeamSetup) => ({
  id: t.id,
  name: t.name,
  players: [
    ...t.starters.map((p) => ({ id: p.id, team_id: t.id, jersey_number: p.jersey, is_starter: true })),
    ...(t.bench ?? []).map((p) => ({ id: p.id, team_id: t.id, jersey_number: p.jersey, is_starter: false }))
  ]
})

export const cdfMeta = (cfg: MatchConfig, periods: ReadonlyArray<PeriodInfo>, extra: { competitionId?: string; seasonId?: string; venueId?: string } = {}) => ({
  competition: { id: extra.competitionId ?? "touchline-league", name: "Touchline League (synthetic)", format: "league_20", type: "mens" },
  season: { id: extra.seasonId ?? "tl-2026", name: "2026" },
  match: {
    id: cfg.matchId,
    kickoff_time: cfg.kickoffTime,
    periods: periods.map((p) => ({
      period: p.period,
      play_direction: "left_right",
      start_time: iso(p.startMs),
      end_time: iso(p.endMs),
      frame_id_start: 0,
      frame_id_end: p.frameIdEnd,
      left_team_id: cfg.home.id,
      right_team_id: cfg.away.id
    })),
    whistles: periods.flatMap((p) => [
      { type: p.period, sub_type: "start", time: iso(p.startMs) },
      { type: p.period, sub_type: "end", time: iso(p.endMs) }
    ])
  },
  teams: { home: team(cfg.home), away: team(cfg.away) },
  venue: { id: extra.venueId ?? "touchline-park", name: "Touchline Park (synthetic)", pitch_length: 105, pitch_width: 68 },
  officials: [{ id: REFEREE_ID, type: "main_referee" }],
  meta: {
    video: null,
    event: { collection_timing: "post_match", name: ENGINE.name, version: ENGINE.version },
    tracking: { version: ENGINE.version, name: ENGINE.name, fps: Math.round(1 / cfg.dt), collection_timing: "post_match" },
    landmarks: null,
    ball: null,
    meta: { version: ENGINE.version, name: ENGINE.name },
    cdf: { version: CDF_VERSION }
  }
})

export const cdfTrackingLine = (matchId: string, cfg: MatchConfig, f: Frame): string =>
  JSON.stringify({
    frame_id: f.frame_id,
    timestamp: f.timestamp,
    period: f.period,
    match: { id: matchId },
    teams: {
      home: { id: cfg.home.id, players: f.home.map(({ id, x, y, vel }) => ({ id, x, y, vel })) },
      away: { id: cfg.away.id, players: f.away.map(({ id, x, y, vel }) => ({ id, x, y, vel })) }
    },
    ball: { x: f.ball.x, y: f.ball.y, z: f.ball.z, status: f.ball_in_play, ...(f.possession_side ? { poss_team_id: f.possession_side === "home" ? cfg.home.id : cfg.away.id } : {}) }
  })

type CdfType = { type: string; sub_type: string | null; outcome_type: string; is_successful: boolean } | null

const RESTART_SUBTYPE: Record<string, string> = { throw_in: "throw_in", corner: "corner_kick", goal_kick: "goal_kick", free_kick: "free_kick", kickoff: "kick_off", penalty: "penalty_kick" }

/** Map a domain event to a CDF type, or null when the event is not exported (reception, possession_change, ...). */
export const cdfTypeOf = (e: DomainEvent): CdfType => {
  const a = e.attrs
  switch (e.type) {
    case "pass": {
      const restart = typeof a.restart === "string" ? RESTART_SUBTYPE[a.restart] ?? null : null
      const outcome = e.outcome === "successful" ? "successful" : e.outcome === "out_of_play" ? "out_of_play" : "intercepted"
      return { type: "pass", sub_type: restart === "penalty_kick" ? null : restart, outcome_type: outcome, is_successful: e.outcome === "successful" }
    }
    case "shot": {
      const sub = a.technique === "penalty" ? "penalty_kick" : a.technique === "free_kick" ? "free_kick" : null
      const outcome = e.outcome === "goal" ? "successful" : String(e.outcome)
      return { type: "shot", sub_type: sub, outcome_type: outcome, is_successful: e.outcome === "goal" }
    }
    case "goal":
      // Goals from shots are carried by the shot event; loose-ball and own-net goals have no shot, so export them as one.
      if (a.from !== "loose_ball" && a.from !== "pass") return null
      return { type: "shot", sub_type: null, outcome_type: a.own_goal === true ? "own_goal" : "successful", is_successful: true }
    case "clearance":
      return { type: "defending", sub_type: "clearance", outcome_type: "clearance", is_successful: true }
    case "interception":
      return { type: "defending", sub_type: "interception", outcome_type: "interception", is_successful: true }
    case "pressure":
      return { type: "defending", sub_type: "pressing", outcome_type: "pressure", is_successful: true }
    case "block":
      return { type: "defending", sub_type: "block", outcome_type: "block", is_successful: true }
    case "keeper_save":
      return { type: "goalkeeping", sub_type: a.technique === "catch" ? "claim" : "save", outcome_type: "save", is_successful: true }
    case "tackle":
      return { type: "misc", sub_type: "tackle", outcome_type: a.outcome === "won" ? "successful" : "unsuccessful", is_successful: a.outcome === "won" }
    case "carry":
    case "take_on":
    case "aerial_duel":
    case "ball_recovery":
      return { type: "misc", sub_type: "other_ball_action", outcome_type: a.outcome === "lost" ? "unsuccessful" : "successful", is_successful: a.outcome !== "lost" }
    case "foul":
      return { type: "referee", sub_type: "foul", outcome_type: "start", is_successful: true }
    case "card":
      return { type: "referee", sub_type: "caution", outcome_type: a.colour === "yellow" ? "yellow_card" : a.colour === "red" ? "red_card" : "second_yellow_card", is_successful: true }
    case "offside":
      return { type: "referee", sub_type: "offside", outcome_type: "offside", is_successful: true }
    case "substitution":
      // Who came on and off stays in the domain stream: CDF referee events carry no player ids.
      return { type: "referee", sub_type: "substitution", outcome_type: "start", is_successful: true }
    default:
      return null
  }
}

const BODY = new Set(["left_foot", "right_foot", "feet", "head", "hands", "upper_body", "lower_body", "body", "other"])

/** Timestamp (ms) of a global tick, using the period table built from frames. */
export type TickClock = (tick: number) => string

export const cdfEventLine = (cfg: MatchConfig, e: DomainEvent, clock: TickClock, periodStartTick: (period: string) => number, receiverTick: number | null): string | null => {
  const t = cdfTypeOf(e)
  if (!t) return null
  const isRef = t.type === "referee"
  const body = typeof e.attrs.body_part === "string" && BODY.has(e.attrs.body_part) ? e.attrs.body_part : null
  const passOrShot = t.type === "pass" || t.type === "shot"
  const receiver = e.type === "pass" && e.outcome === "successful" ? (e.attrs.receiver_id as string | undefined) ?? null : null
  const start = periodStartTick(e.period)
  const event: Record<string, unknown> = {
    id: e.id,
    time: clock(e.frame_id),
    period: e.period,
    type: t.type,
    sub_type: t.sub_type,
    is_successful: t.is_successful,
    outcome_type: t.outcome_type,
    receiver_id: receiver,
    receiver_time: receiver && receiverTick !== null ? clock(receiverTick) : null,
    receiver_team_id: receiver ? e.team_id : null,
    x: e.x ?? 0,
    y: e.y ?? 0,
    x_end: e.x_end ?? (passOrShot ? e.x ?? 0 : null),
    y_end: e.y_end ?? (passOrShot ? e.y ?? 0 : null),
    body_part: body ?? (passOrShot ? "other" : null),
    related_event_ids: null,
    match_clock: e.match_clock
  }
  if (isRef) event.official_id = REFEREE_ID
  else {
    event.player_id = e.player_id
    event.team_id = e.team_id
  }
  const metrics: Record<string, number> = {}
  if (typeof e.attrs.xg === "number") metrics.xg = e.attrs.xg
  if (typeof e.attrs.xpass === "number") metrics.xpass = e.attrs.xpass
  if (Object.keys(metrics).length) event.metrics = metrics
  const tracking: Record<string, number> = { frame_id: e.frame_id - start }
  if (e.frame_id_end !== null) tracking.frame_id_end = e.frame_id_end - start
  return JSON.stringify({ match: { id: e.match_id }, meta: { is_synced: true }, event, tracking })
}
