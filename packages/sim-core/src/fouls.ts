import type { Bearing } from "./duel.js"
import type { Params } from "./params.js"

/**
 * T3: how foul-prone a challenge is by where the victim is, on his u in his own attacking frame (u = +52.5 is the goal he
 * attacks): 1 in his own half, linear to `finalThird` at u = `finalThirdU`, `finalThird` beyond, `box` in the box he attacks.
 */
export const zoneFactor = (u: number, inBox: boolean, f: Params["fouls"]): number => {
  if (inBox) return f.box
  if (u <= 0) return 1
  if (u >= f.finalThirdU) return f.finalThird
  return 1 + (f.finalThird - 1) * (u / f.finalThirdU)
}

/** T3: how foul-prone a challenge is by the challenger's bearing from the victim's run: front 1, side, behind. */
export const angleFactor = (b: Bearing, f: Params["fouls"]): number => (b === "front" ? 1 : b === "side" ? f.side : f.behind)
