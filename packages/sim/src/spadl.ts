/**
 * SPADL view of a match (spec §5.1.9, §5.1.10): one action per on-ball event, in SPADL's coordinates
 * (0..105 x 0..68, origin at a corner) and socceraction's stored frame: the home team attacks left to right, the
 * away team right to left (socceraction's play_left_to_right() turns this into every team attacking left to right).
 * The type, result and body-part lists (and their ids, which are list positions) follow SPADL as defined by
 * socceraction (MIT, ML-KULeuven), so the output loads into its tools unchanged.
 */
import { round2, type DomainEvent, type MatchConfig } from "@touchline/sim-core"

export const SPADL_ACTIONTYPES = [
  "pass", "cross", "throw_in", "freekick_crossed", "freekick_short", "corner_crossed", "corner_short", "take_on", "foul", "tackle",
  "interception", "shot", "shot_penalty", "shot_freekick", "keeper_save", "keeper_claim", "keeper_punch", "keeper_pick_up", "clearance",
  "bad_touch", "non_action", "dribble", "goalkick"
] as const
export const SPADL_RESULTS = ["fail", "success", "offside", "owngoal", "yellow_card", "red_card"] as const
export const SPADL_BODYPARTS = ["foot", "head", "other", "head/other", "foot_left", "foot_right"] as const

type ActionType = (typeof SPADL_ACTIONTYPES)[number]
type Result = (typeof SPADL_RESULTS)[number]
type Bodypart = (typeof SPADL_BODYPARTS)[number]

export interface SpadlAction {
  readonly game_id: string
  readonly original_event_id: string
  readonly action_id: number
  readonly period_id: 1 | 2
  readonly time_seconds: number
  readonly team_id: string
  readonly player_id: string
  readonly start_x: number
  readonly start_y: number
  readonly end_x: number
  readonly end_y: number
  readonly type_id: number
  readonly type_name: ActionType
  readonly result_id: number
  readonly result_name: Result
  readonly bodypart_id: number
  readonly bodypart_name: Bodypart
}

const passType = (e: DomainEvent): ActionType => {
  const high = e.attrs.height !== "ground"
  switch (e.attrs.restart) {
    case "throw_in":
      return "throw_in"
    case "corner":
      return high ? "corner_crossed" : "corner_short"
    case "free_kick":
      return high ? "freekick_crossed" : "freekick_short"
    case "goal_kick":
      return "goalkick"
    default:
      return e.attrs.kind === "cross" ? "cross" : "pass"
  }
}

/** SPADL type and result of a domain event, or null when the event is not an on-ball action. */
const typeAndResult = (e: DomainEvent, cardOf: (e: DomainEvent) => Result | null): [ActionType, Result] | null => {
  switch (e.type) {
    case "pass":
      return [passType(e), e.outcome === "successful" ? "success" : e.outcome === "offside" ? "offside" : "fail"]
    case "shot":
      return [e.attrs.technique === "penalty" ? "shot_penalty" : e.attrs.technique === "free_kick" ? "shot_freekick" : "shot", e.outcome === "goal" ? "success" : "fail"]
    case "carry":
      return ["dribble", "success"]
    case "take_on":
      return ["take_on", e.outcome === "won" ? "success" : "fail"]
    case "tackle":
      return ["tackle", e.outcome === "won" ? "success" : "fail"]
    case "foul":
      return ["foul", cardOf(e) ?? "fail"]
    case "interception":
      return ["interception", "success"]
    case "clearance":
      return ["clearance", "success"]
    case "keeper_save":
      return ["keeper_save", "success"]
    case "keeper_claim":
      return ["keeper_claim", e.attrs.handling === "fumble" ? "fail" : "success"]
    case "keeper_punch":
      return ["keeper_punch", "success"]
    case "reception":
      return e.attrs.first_touch !== undefined && e.attrs.first_touch !== "controlled" ? ["bad_touch", "fail"] : null
    default:
      return null
  }
}

const bodypart = (e: DomainEvent): Bodypart =>
  e.attrs.body_part === "left_foot" ? "foot_left" : e.attrs.body_part === "right_foot" ? "foot_right" : e.attrs.body_part === "head" ? "head" : e.attrs.body_part === "hands" ? "other" : "foot"

const clamp = (v: number, hi: number) => round2(Math.max(0, Math.min(hi, v)))

/** SPADL actions for a match's domain events, in frame order. */
export const spadlActions = (events: ReadonlyArray<DomainEvent>, cfg: MatchConfig): SpadlAction[] => {
  const ordered = [...events].sort((a, b) => a.frame_id - b.frame_id)
  const cards = ordered.filter((e) => e.type === "card")
  const cardOf = (foul: DomainEvent): Result | null => {
    const c = cards.find((k) => k.frame_id === foul.frame_id && k.player_id === foul.player_id)
    return c ? (c.attrs.colour === "yellow" ? "yellow_card" : "red_card") : null
  }
  const out: SpadlAction[] = []
  for (const e of ordered) {
    const tr = typeAndResult(e, cardOf)
    if (!tr || e.team_id === null || e.player_id === null || e.x === null || e.y === null) continue
    // Home attacks +x for the whole match, which is socceraction's stored frame: shift the origin to the corner.
    const sx = (x: number) => clamp(x + 52.5, 105)
    const sy = (y: number) => clamp(y + 34, 68)
    const bp = bodypart(e)
    out.push({
      game_id: e.match_id,
      original_event_id: e.id,
      action_id: out.length,
      period_id: e.period === "first_half" ? 1 : 2,
      time_seconds: round2(e.period_frame_id * cfg.dt),
      team_id: e.team_id,
      player_id: e.player_id,
      start_x: sx(e.x),
      start_y: sy(e.y),
      end_x: sx(e.x_end ?? e.x),
      end_y: sy(e.y_end ?? e.y),
      type_id: SPADL_ACTIONTYPES.indexOf(tr[0]),
      type_name: tr[0],
      result_id: SPADL_RESULTS.indexOf(tr[1]),
      result_name: tr[1],
      bodypart_id: SPADL_BODYPARTS.indexOf(bp),
      bodypart_name: bp
    })
  }
  return out
}

const COLUMNS = [
  "game_id", "original_event_id", "action_id", "period_id", "time_seconds", "team_id", "player_id", "start_x", "start_y", "end_x", "end_y",
  "type_id", "type_name", "result_id", "result_name", "bodypart_id", "bodypart_name"
] as const

/** The actions as CSV with SPADL's column names. */
export const spadlCsv = (events: ReadonlyArray<DomainEvent>, cfg: MatchConfig): string =>
  [COLUMNS.join(","), ...spadlActions(events, cfg).map((a) => COLUMNS.map((c) => String(a[c])).join(","))].join("\n") + "\n"
