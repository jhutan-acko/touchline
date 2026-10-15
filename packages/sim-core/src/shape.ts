import { ruleAnchor, type AnchorInput, type Positioning } from "./anchor.js"
import { clamp, dirOf, PITCH, type Period, type Side, type Vec2 } from "./geometry.js"
import type { FormationName, Role, TeamStyle } from "./types.js"

export interface Slot {
  readonly role: Role
  /** Base anchor for a team attacking +x with the ball on the centre spot. */
  readonly x: number
  readonly y: number
}

export const FORMATIONS: Readonly<Record<FormationName, ReadonlyArray<Slot>>> = {
  "4-3-3": [
    { role: "GK", x: -48, y: 0 },
    { role: "FB", x: -28, y: 24 },
    { role: "CB", x: -32, y: 8 },
    { role: "CB", x: -32, y: -8 },
    { role: "FB", x: -28, y: -24 },
    { role: "CM", x: -12, y: 13 },
    { role: "DM", x: -18, y: 0 },
    { role: "CM", x: -12, y: -13 },
    { role: "W", x: 4, y: 24 },
    { role: "ST", x: 6, y: 0 },
    { role: "W", x: 4, y: -24 }
  ],
  "4-4-2": [
    { role: "GK", x: -48, y: 0 },
    { role: "FB", x: -29, y: 23 },
    { role: "CB", x: -32, y: 7 },
    { role: "CB", x: -32, y: -7 },
    { role: "FB", x: -29, y: -23 },
    { role: "W", x: -12, y: 24 },
    { role: "CM", x: -15, y: 7 },
    { role: "CM", x: -15, y: -7 },
    { role: "W", x: -12, y: -24 },
    { role: "ST", x: 2, y: 5 },
    { role: "ST", x: 2, y: -5 }
  ],
  "4-2-3-1": [
    { role: "GK", x: -48, y: 0 },
    { role: "FB", x: -28, y: 24 },
    { role: "CB", x: -32, y: 8 },
    { role: "CB", x: -32, y: -8 },
    { role: "FB", x: -28, y: -24 },
    { role: "DM", x: -19, y: 7 },
    { role: "DM", x: -19, y: -7 },
    { role: "W", x: -4, y: 22 },
    { role: "AM", x: -4, y: 0 },
    { role: "W", x: -4, y: -22 },
    { role: "ST", x: 6, y: 0 }
  ],
  "3-5-2": [
    { role: "GK", x: -48, y: 0 },
    { role: "CB", x: -32, y: 12 },
    { role: "CB", x: -34, y: 0 },
    { role: "CB", x: -32, y: -12 },
    { role: "FB", x: -16, y: 27 },
    { role: "CM", x: -15, y: 9 },
    { role: "DM", x: -19, y: 0 },
    { role: "CM", x: -15, y: -9 },
    { role: "FB", x: -16, y: -27 },
    { role: "ST", x: 3, y: 5 },
    { role: "ST", x: 3, y: -5 }
  ]
}

/**
 * Anchor for a slot given the ball position. Computed in "attacking +x" space, then mirrored
 * for the away side. Line height and compactness come from the team style.
 */
export const anchorFor = (
  formation: FormationName,
  slot: number,
  side: Side,
  period: Period,
  ball: Vec2,
  style: TeamStyle,
  inPossession: boolean,
  spread: { readonly width: number; readonly depth: number; readonly defDepth?: number } = { width: 1, depth: 1 },
  /**
   * With the rule table switched on (positioning.rule 1): this player's blend, drift and caps (anchor.ts). `inPossession`
   * is then ignored (the blend names the rows) and `ball` is the ball as anchors read it.
   */
  ctx?: { readonly pos: Positioning; readonly input: AnchorInput }
): Vec2 => {
  if (ctx && ctx.pos.rule > 0) return ruleAnchor(formation, FORMATIONS[formation], slot, side, period, ball, style, spread, ctx.pos, ctx.input)
  const s = FORMATIONS[formation][slot]!
  const d = dirOf(side, period)
  const bx = ball.x * d
  const by = ball.y * d
  if (s.role === "GK") {
    const gx = -PITCH.halfL + 3 + Math.max(0, bx + PITCH.halfL) * 0.06
    return { x: gx * d, y: clamp(by * 0.12, -4, 4) * d }
  }
  const slide = 0.5
  const line = style.lineHeight * 8 + (inPossession ? 7 : -2)
  const compact = 1 - 0.35 * style.compactness
  // Width stretches the shape fully in possession and partly without it; depth stretches the
  // distance between lines around the team's centre (x = -18 in attacking space).
  const width = inPossession ? spread.width : 1 + (spread.width - 1) * 0.4
  // Without the ball, defDepth squeezes the lines further (identity by default).
  const depth = spread.depth * (inPossession ? 1 : (spread.defDepth ?? 1))
  const sx = -18 + (s.x + 18) * depth
  const x = clamp(sx + slide * bx + line, -PITCH.halfL + 4, PITCH.halfL - 3)
  const y = clamp(s.y * compact * width + 0.35 * by, -PITCH.halfW + 1.5, PITCH.halfW - 1.5)
  return { x: x * d, y: y * d }
}

/** Kickoff anchors: like shape anchors but clamped to the team's own half. */
export const kickoffAnchor = (formation: FormationName, slot: number, side: Side, period: Period, style: TeamStyle): Vec2 => {
  const a = anchorFor(formation, slot, side, period, { x: 0, y: 0 }, style, false)
  const d = dirOf(side, period)
  const ax = Math.min(a.x * d, -1.5)
  return { x: ax * d, y: a.y }
}
