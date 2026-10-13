import { inOwnBox } from "./deflect.js"
import type { Period, Side } from "./geometry.js"
import type { PlayerState } from "./types.js"

/**
 * Whether a keeper who has just won the ball has it in his hands: in his own box, unless his own side touched it last
 * (a back pass or his side's loose ball must be played with the feet). Always false under the old rule (rule 0).
 */
export const keeperInHands = (rule: number, keeper: PlayerState, period: Period, lastTouchSide: Side | null): boolean =>
  rule > 0 && keeper.role === "GK" && inOwnBox(keeper.side, period, keeper.pos) && lastTouchSide !== keeper.side
