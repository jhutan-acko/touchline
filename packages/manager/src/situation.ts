/**
 * What the manager agent sees (spec §4): `situationAt` builds the Situation from the paused state and from what the
 * match produced up to that tick (its events, fed to the stats engine), from the managed team's side. Nothing else
 * reaches the model: no seed, random state, script, forced outcome or truth, nothing after the pause, and not the
 * added time the engine has already drawn (only the expected added time).
 */
import { createHash } from "node:crypto"
import { availableBench, isHalfTimeBreak, STYLE_RANGES, subsLeft, windowsLeft, type DomainEvent, type MatchConfig, type MatchState, type Side, type StepOutput, type StyleKey } from "@touchline/sim-core"
import { decodeSituation, type MomentReason, type Situation } from "@touchline/schema"
import { infoFromConfig, type StatsEngine, type StatsModels, StatsEngine as Engine, type XtGrid } from "@touchline/stats"
import { minuteOf } from "./moments.js"

/** What each style setting does, as the model reads it. */
export const STYLE_MEANINGS: Readonly<Record<StyleKey, string>> = {
  pressIntensity: "0 never press .. 1 press the ball carrier at every chance",
  lineHeight: "-1 deep defensive line .. 1 high line",
  compactness: "0 spread wide .. 1 narrow, compact block",
  tempo: "0 patient build-up .. 1 quick, forward passing",
  longBallBias: "-1 short passes only .. 1 long balls often",
  crossBias: "-1 avoid crosses .. 1 cross often",
  riskTolerance: "0 safe passes and few shots .. 1 risky passes and shots"
}

/** Minutes of play the recent view covers. */
export const RECENT_MIN = 10

/** The match as it has been played so far: its events and the stats engine fed with every step. */
export class MatchWatch {
  readonly events: DomainEvent[] = []
  readonly engine: StatsEngine

  constructor(cfg: MatchConfig, models: StatsModels, xt: XtGrid | null) {
    this.engine = new Engine(infoFromConfig(cfg), models, xt)
  }

  /** One step's output: its events, then its frame (the order the live stats stream uses). */
  add(r: StepOutput): void {
    for (const event of r.events) {
      this.events.push(event)
      this.engine.ingest({ kind: "event", event })
    }
    if (r.frame) this.engine.ingest({ kind: "frame", frame: r.frame })
  }
}

const round = (x: number, digits: number) => Math.round(x * 10 ** digits) / 10 ** digits
const other = (side: Side): Side => (side === "home" ? "away" : "home")

const scoreState = (diff: number) => (diff === 0 ? "level" : diff > 0 ? `winning by ${diff}` : `losing by ${-diff}`)

/** The pre-match name of a player (league squads carry names; test teams do not). */
const nameOf = (cfg: MatchConfig, id: string): string => {
  const all = [...cfg.home.starters, ...(cfg.home.bench ?? []), ...cfg.away.starters, ...(cfg.away.bench ?? [])] as ReadonlyArray<{ readonly id: string; readonly name?: string }>
  return all.find((p) => p.id === id)?.name ?? id
}

/** The managed team's view of the match at the pause, for a decision made for `reasons`. */
export const situationAt = (s: MatchState, side: Side, reasons: ReadonlyArray<MomentReason>, watch: MatchWatch): Situation => {
  const cfg = s.config
  const team = cfg[side]
  const opp = cfg[other(side)]
  const eng = watch.engine
  const events = watch.events.filter((e) => e.frame_id <= s.tick)
  const ofTeam = (id: string) => events.filter((e) => e.team_id === id)
  const value = (metric: string, subject: string, windowS: number | null = null) => eng.value(metric as never, subject, { windowS })
  const count = (es: ReadonlyArray<DomainEvent>, type: string, pred: (e: DomainEvent) => boolean = () => true) => es.filter((e) => e.type === type && pred(e)).length
  const regains = (es: ReadonlyArray<DomainEvent>) =>
    count(es, "tackle", (e) => e.attrs.outcome === "won") + count(es, "interception") + count(es, "ball_recovery")

  // Possession as a share of the time either team had the ball (the engine also counts contested time), so the two add to 100.
  const poss = (id: string) => value("team.poss", id) ?? 0
  const possTotal = poss(team.id) + poss(opp.id)
  const teamView = (t: MatchConfig["home"]) => {
    const es = ofTeam(t.id)
    const pct = (x: number | null) => (x === null ? null : round(x * 100, 1))
    return {
      name: t.name,
      archetype: t.style.archetype,
      formation: t.formation,
      style: (Object.keys(STYLE_RANGES) as StyleKey[]).map((k) => ({
        setting: k,
        value: round(t.style[k], 2),
        min: STYLE_RANGES[k][0],
        max: STYLE_RANGES[k][1],
        meaning: STYLE_MEANINGS[k]
      })),
      stats: {
        xg: round(value("shot.xg", t.id) ?? 0, 2),
        shots: count(es, "shot"),
        possession_pct: possTotal > 0 ? round((100 * poss(t.id)) / possTotal, 1) : 50,
        pass_completion_pct: pct(value("pass.acc", t.id)),
        ppda: (() => {
          const v = value("ppda", t.id)
          return v === null || !Number.isFinite(v) ? null : round(v, 1)
        })(),
        yellow_cards: count(es, "card", (e) => e.attrs.colour === "yellow"),
        red_cards: count(es, "card", (e) => e.attrs.colour === "red")
      }
    }
  }

  const minute = minuteOf(s)
  const addedMin = (cfg.params.timing.addedTimeMinS[0] + cfg.params.timing.addedTimeMinS[1]) / 2 / 60
  const inPeriod = minute - (s.period === "first_half" ? 0 : 45)
  const minutesLeft = Math.max(0, 45 + addedMin - inPeriod) + (s.period === "first_half" ? 45 + addedMin : 0)
  // Minutes on the match clock: a starter has played `minute`, a substitute the minutes since coming on.
  const secondHalfStart = s.period === "second_half" ? s.tick - s.periodTick : Infinity
  const clockAt = (tick: number) => (tick >= secondHalfStart ? 45 + ((tick - secondHalfStart) * cfg.dt) / 60 : (tick * cfg.dt) / 60)
  const entered = new Map(events.filter((e) => e.type === "substitution").map((e) => [e.attrs.player_on as string, clockAt(e.frame_id)]))
  const mine = s.players.filter((p) => p.side === side && !p.sentOff)
  const recentFrom = s.tick - Math.round((RECENT_MIN * 60) / cfg.dt)
  const recent = (id: string) => {
    const es = ofTeam(id).filter((e) => e.frame_id > recentFrom)
    return { xg: round(value("shot.xg", id, RECENT_MIN * 60) ?? 0, 2), shots: count(es, "shot"), ball_regains: regains(es) }
  }
  const benchLeft = new Set(availableBench(s, side).map((b) => b.id))
  const by = (id: string) => events.filter((e) => e.player_id === id)

  return {
    match_id: cfg.matchId,
    team_id: team.id,
    moment: {
      reasons: [...reasons],
      minute: round(minute, 1),
      minutes_left: round(minutesLeft, 1),
      added_time_expected_min: round(addedMin, 1),
      score: { for: s.score[side], against: s.score[other(side)] },
      score_state: scoreState(s.score[side] - s.score[other(side)])
    },
    team: teamView(team),
    opponent: teamView(opp),
    players: {
      on_pitch: mine.map((p) => ({
        id: p.id,
        name: nameOf(cfg, p.id),
        number: p.jersey,
        role: p.role,
        energy_pct: Math.round(p.energy * 100),
        minutes_played: round(minute - (entered.get(p.id) ?? 0), 1),
        yellow_card: p.yellow > 0,
        shots: count(by(p.id), "shot"),
        xg: round(value("shot.xg", p.id) ?? 0, 2),
        passes_completed: count(by(p.id), "pass", (e) => e.outcome === "successful"),
        tackles_won: count(by(p.id), "tackle", (e) => e.attrs.outcome === "won")
      })),
      bench: (team.bench ?? []).map((b) => ({ id: b.id, name: nameOf(cfg, b.id), number: b.jersey, role: b.role, available: benchLeft.has(b.id) }))
    },
    limits: { subs_left: subsLeft(s, side), windows_left: windowsLeft(s, side), half_time_break: isHalfTimeBreak(s) },
    recent: { window_min: RECENT_MIN, team: recent(team.id), opponent: recent(opp.id) }
  }
}

/** The exact JSON sent to the model (and hashed into the decision log). */
export const situationJson = (sit: Situation): string => JSON.stringify(decodeSituation(sit))

/** sha256 of the exact payload: the decision log records it, so what was sent can be checked against what was logged. */
export const situationHash = (sit: Situation): string => createHash("sha256").update(situationJson(sit)).digest("hex")

/** A rough token count of the payload (characters / 4). */
export const payloadTokens = (sit: Situation): number => Math.ceil(situationJson(sit).length / 4)

/** The most tokens a Situation may take. */
export const MAX_SITUATION_TOKENS = 2500
