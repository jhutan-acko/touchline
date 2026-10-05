import type { Side } from "./geometry.js"
import type { Params } from "./params.js"
import type { Period } from "./types.js"

/** What a scenario script can make happen (spec §5.1.7). */
export const EFFECTS = ["goal", "red_card", "press_surge", "keeper_heroics", "momentum_swing", "keeper_howler", "defensive_error"] as const
export type ScenarioEffect = (typeof EFFECTS)[number]

/**
 * One scripted effect for `team` between two match minutes. The team is the one the effect is about:
 * it scores (`goal`), has a player sent off (`red_card`), presses (`press_surge`), attacks (`momentum_swing`),
 * or its keeper or defenders shine or err (`keeper_heroics`, `keeper_howler`, `defensive_error`).
 * `count` is how many times it should happen in the window (goals; default 1).
 */
export interface ScriptEntry {
  readonly window: readonly [number, number]
  readonly team: Side
  readonly effect: ScenarioEffect
  readonly count?: number
}

export interface Script {
  readonly name: string
  readonly entries: ReadonlyArray<ScriptEntry>
}

/** Per-team multipliers and logit shifts at one moment of a match, from the script entries active then. */
export interface Mods {
  /** Added to the team's shot, cross and through-ball logits. */
  readonly shotLogit: number
  readonly attackLogit: number
  /** Multiplies the chance that the team's shots score. */
  readonly scoring: number
  /** Multiply the team's pressing and tackling rates. */
  readonly press: number
  readonly tackle: number
  /** Multiply the chance that the team's tackles are fouls, and that its fouls are red cards. */
  readonly foul: number
  readonly red: number
  /** Added to the team keeper's save logit; added to its share of fumbled saves. */
  readonly saveLogit: number
  readonly fumble: number
  /** Multiplies the mis-hit chance of the team's defenders (CB, FB, DM) in their own half. */
  readonly mishit: number
  /** Multiplies the team's shooting error (below 1: sharper finishing). */
  readonly aim: number
  /** A press surge is on: the two nearest defenders press, from further away (not just any rise in pressing). */
  readonly surge: boolean
}

export const NO_MODS: Mods = { shotLogit: 0, attackLogit: 0, scoring: 1, press: 1, tackle: 1, foul: 1, red: 1, saveLogit: 0, fumble: 0, mishit: 1, aim: 1, surge: false }

/**
 * Whether match minute `minute` of `period` is inside a window. Minutes 45+ happen in both halves (first-half added
 * time, then the second half), so a window starting at 45 or later belongs to the second half and one ending at 45 or
 * earlier to the first; without a period only the minutes are compared.
 */
export const inWindow = (window: readonly [number, number], minute: number, period?: Period): boolean =>
  minute >= window[0] && minute < window[1] && !(period === "first_half" && window[0] >= 45) && !(period === "second_half" && window[1] <= 45)

/**
 * The modifiers for `side` at `minute` of `period`: neutral without a script, outside every window, or for the other
 * team. `goals[i]` counts the goals scored so far in entry i's window; a goal entry stops nudging once its count is reached.
 */
export const modsFor = (script: Script | undefined, side: Side, minute: number, p: Params, goals: ReadonlyArray<number> = [], period?: Period): Mods => {
  if (!script) return NO_MODS
  const s = p.script
  let m = NO_MODS
  script.entries.forEach((e, i) => {
    if (e.team !== side || !inWindow(e.window, minute, period)) return
    switch (e.effect) {
      case "goal": {
        if ((goals[i] ?? 0) >= (e.count ?? 1)) return
        // The nudge grows with the scoring rate the window asks for (r = 1 for about a normal rate); a team
        // chasing goals also plays forward more (half the shot shift on crosses and through balls).
        const r = Math.max(1, (e.count ?? 1) / Math.max(1, e.window[1] - e.window[0]) / s.goalRatePerMin)
        const shift = s.goalShotLogit * Math.log2(1 + r)
        m = {
          ...m,
          shotLogit: m.shotLogit + shift,
          attackLogit: m.attackLogit + shift / 2,
          scoring: m.scoring * Math.min(s.goalScoringMax, s.goalScoring * Math.pow(r, 0.75)),
          aim: m.aim * Math.max(s.goalAimMin, 1 / Math.sqrt(r))
        }
        break
      }
      case "momentum_swing":
        m = { ...m, shotLogit: m.shotLogit + s.momentumLogit, attackLogit: m.attackLogit + s.momentumLogit, press: m.press * s.momentumPress }
        break
      case "press_surge":
        m = { ...m, press: m.press * s.pressSurge, tackle: m.tackle * s.pressTackle, surge: true }
        break
      case "red_card":
        m = { ...m, foul: m.foul * s.redFoul, red: m.red * s.redCard }
        break
      case "keeper_heroics":
        m = { ...m, saveLogit: m.saveLogit + s.heroicsSave }
        break
      case "keeper_howler":
        m = { ...m, saveLogit: m.saveLogit - s.howlerSave, fumble: m.fumble + s.howlerFumble }
        break
      case "defensive_error":
        m = { ...m, mishit: m.mishit * s.errorMishit }
        break
    }
  })
  return m
}

/**
 * The forced outcomes still needed: a goal entry keeps at most as many forced goals as it is short of its count
 * (goals scored naturally meanwhile count towards it); other forced outcomes are kept.
 */
export const outstandingForces = (script: Script | undefined, forced: ReadonlyArray<ScriptEntry>, goals: ReadonlyArray<number>): ScriptEntry[] => {
  const entries = script?.entries ?? []
  const left = entries.map((e, i) => (e.effect === "goal" ? Math.max(0, (e.count ?? 1) - (goals[i] ?? 0)) : Infinity))
  return forced.filter((f) => {
    const i = entries.indexOf(f)
    if (i < 0 || f.effect !== "goal") return true
    if (left[i]! <= 0) return false
    left[i]!--
    return true
  })
}

/** Count a goal for `side` at `minute` against every goal entry for that side whose window contains it. */
export const countGoal = (script: Script | undefined, goals: ReadonlyArray<number>, side: Side, minute: number, period?: Period): number[] =>
  (script?.entries ?? []).map((e, i) => (goals[i] ?? 0) + (e.effect === "goal" && e.team === side && inWindow(e.window, minute, period) ? 1 : 0))
