import type { Side } from "./geometry.js"
import type { Params } from "./params.js"

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
}

export const NO_MODS: Mods = { shotLogit: 0, attackLogit: 0, scoring: 1, press: 1, tackle: 1, foul: 1, red: 1, saveLogit: 0, fumble: 0, mishit: 1 }

/** The modifiers for `side` at `minute`: neutral without a script, outside every window, or for the other team. */
export const modsFor = (script: Script | undefined, side: Side, minute: number, p: Params): Mods => {
  if (!script) return NO_MODS
  const s = p.script
  let m = NO_MODS
  for (const e of script.entries) {
    if (e.team !== side || minute < e.window[0] || minute >= e.window[1]) continue
    switch (e.effect) {
      case "goal":
        m = { ...m, shotLogit: m.shotLogit + s.goalShotLogit, scoring: m.scoring * s.goalScoring }
        break
      case "momentum_swing":
        m = { ...m, shotLogit: m.shotLogit + s.momentumLogit, attackLogit: m.attackLogit + s.momentumLogit, press: m.press * s.momentumPress }
        break
      case "press_surge":
        m = { ...m, press: m.press * s.pressSurge, tackle: m.tackle * s.pressTackle }
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
  }
  return m
}
