import { inOwnBox } from "./deflect.js"
import type { Period, Side } from "./geometry.js"
import type { PlayerState } from "./types.js"

/**
 * Whether a keeper who has just won the ball has it in his hands: in his own box, unless his own side touched it last
 * (a back pass or a ball a teammate touched last must be played with the feet; his own last touch, such as a parry or a fumble, still counts as hands).
 * Always false under the old rule (rule 0).
 */
export const keeperInHands = (rule: number, keeper: PlayerState, period: Period, lastTouch: { readonly side: Side; readonly playerId: string } | null): boolean =>
  rule > 0 && keeper.role === "GK" && inOwnBox(keeper.side, period, keeper.pos) && (lastTouch === null || lastTouch.side !== keeper.side || lastTouch.playerId === keeper.id)
