import type { Params } from "./params.js"
import type { Period } from "./types.js"

/**
 * How likely a shot is to score relative to its xG, from the game state (spec §5.1.4): the minute profile
 * (15-minute bins, the last one including added time) times the red-card factor when the teams are uneven.
 * Penalties are not scaled.
 */
export const scoringFactor = (minute: number, ownPlayers: number, opponentPlayers: number, p: Params, period?: Period): number => {
  const g = p.gameState
  const raw = Math.max(0, Math.min(g.minuteProfile.length - 1, Math.floor(minute / 15)))
  // First-half added time (minute 45+) stays in the first half's last bin.
  const bin = period === "first_half" ? Math.min(raw, Math.floor(g.minuteProfile.length / 2) - 1) : raw
  const red = ownPlayers < opponentPlayers ? g.redCardOwn : ownPlayers > opponentPlayers ? g.redCardOpponent : 1
  return g.minuteProfile[bin]! * red
}
