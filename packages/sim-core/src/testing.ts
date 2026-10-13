/**
 * Test helpers shared by every package's tests (exported as "@touchline/sim-core/testing").
 * Deliberately independent of step.ts so early tasks can use it.
 */
import { DEFAULT_PARAMS } from "./params.js"
import { Rng, seedRng } from "./rng.js"
import { FORMATIONS, kickoffAnchor } from "./shape.js"
import type { FormationName, MatchConfig, PlayerAttrs, PlayerState, TeamSetup, TeamStyle } from "./types.js"

export const STYLES: Readonly<Record<TeamStyle["archetype"], TeamStyle>> = {
  high_press: { archetype: "high_press", pressIntensity: 0.9, lineHeight: 0.8, compactness: 0.6, tempo: 0.8, longBallBias: -0.2, crossBias: 0.0, riskTolerance: 0.6 },
  possession: { archetype: "possession", pressIntensity: 0.6, lineHeight: 0.5, compactness: 0.5, tempo: 0.4, longBallBias: -0.6, crossBias: -0.3, riskTolerance: 0.4 },
  direct: { archetype: "direct", pressIntensity: 0.4, lineHeight: 0.0, compactness: 0.5, tempo: 0.8, longBallBias: 0.7, crossBias: 0.5, riskTolerance: 0.6 },
  low_block: { archetype: "low_block", pressIntensity: 0.15, lineHeight: -0.8, compactness: 0.9, tempo: 0.3, longBallBias: 0.3, crossBias: 0.2, riskTolerance: 0.3 }
}

export const makeTeam = (id: string, formation: FormationName, style: TeamStyle, seed: number): TeamSetup => {
  const rng = new Rng(seedRng(seed))
  const attr = (): number => Math.round(rng.range(0.45, 0.85) * 100) / 100
  const attrs = (): PlayerAttrs => ({
    pace: attr(), acceleration: attr(), shortPassing: attr(), longPassing: attr(), vision: attr(), crossing: attr(),
    dribbling: attr(), finishing: attr(), heading: attr(), tackling: attr(), composure: attr(), stamina: attr(), handling: attr(), reflexes: attr()
  })
  const benchRoles = ["GK", "CB", "FB", "DM", "CM", "AM", "W", "ST", "CM"] as const
  return {
    id,
    name: id,
    formation,
    style,
    starters: FORMATIONS[formation].map((slot, i) => ({ id: `${id}-${String(i + 1).padStart(2, "0")}`, role: slot.role, jersey: i + 1, attrs: attrs() })),
    bench: benchRoles.map((role, i) => ({ id: `${id}-${String(i + 12).padStart(2, "0")}`, role, jersey: i + 12, attrs: attrs() }))
  }
}

export const makeConfig = (seed: number, overrides: Partial<MatchConfig> = {}): MatchConfig => ({
  matchId: "m-test",
  seed,
  kickoffTime: "2026-10-18T14:00:00.000Z",
  home: makeTeam("home-fc", "4-3-3", STYLES.possession, 11),
  away: makeTeam("away-fc", "4-4-2", STYLES.direct, 22),
  params: DEFAULT_PARAMS,
  dt: 0.1,
  ...overrides
})

/** Both teams standing in their kickoff shape (home slots 0-10, then away slots 0-10). */
export const kickoffPlayersFor = (cfg: MatchConfig): PlayerState[] =>
  (["home", "away"] as const).flatMap((side) => {
    const team = side === "home" ? cfg.home : cfg.away
    return team.starters.map((pl, slot) => ({
      id: pl.id, side, role: pl.role, slot, jersey: pl.jersey, attrs: pl.attrs, foot: pl.preferredFoot ?? "right",
      pos: kickoffAnchor(team.formation, slot, side, "first_half", team.style), vel: { x: 0, y: 0 },
      intent: { kind: "shape" as const }, intentUntil: 0, energy: 1, yellow: 0, sentOff: false
    }))
  })
