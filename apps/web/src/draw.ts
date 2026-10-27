/**
 * Drawing the 2D pitch (spec §5.6) on a canvas: 105 × 68 m, x along the length (home attacks +x in the first half),
 * y across. Pure: everything goes through the 2D context it is given, so tests can record the calls.
 */
import type { PitchFrame } from "@touchline/rpc"
import { inkOn } from "./colours.js"

export const LENGTH = 105
export const WIDTH = 68

export interface Size {
  readonly w: number
  readonly h: number
}

export interface Kits {
  readonly home: string
  readonly away: string
}

/** Pitch metres to canvas pixels (y up on the pitch is up on the screen). */
export const toPx = (size: Size, x: number, y: number): [number, number] => [((x + LENGTH / 2) / LENGTH) * size.w, ((WIDTH / 2 - y) / WIDTH) * size.h]

type Ctx = Pick<CanvasRenderingContext2D, "fillRect" | "strokeRect" | "beginPath" | "arc" | "moveTo" | "lineTo" | "stroke" | "fill"> & {
  fillStyle: CanvasRenderingContext2D["fillStyle"]
  strokeStyle: CanvasRenderingContext2D["strokeStyle"]
  lineWidth: number
} & Partial<Pick<CanvasRenderingContext2D, "fillText" | "font" | "textAlign" | "textBaseline">>

const PITCH = "#1f6b3a"
const LINE = "#e8f5ec"
const BALL = "#ffffff"

const box = (ctx: Ctx, size: Size, x0: number, x1: number, halfW: number) => {
  const [a, b] = toPx(size, x0, halfW)
  const [c, d] = toPx(size, x1, -halfW)
  ctx.strokeRect(Math.min(a, c), b, Math.abs(c - a), d - b)
}

/** Mown stripes across the pitch, alternating shades (the 3D grass). */
export const STRIPES = ["#2a723c", "#2f7d43"] as const

/** The markings: touchlines, halfway line, centre circle, penalty and goal areas; on mown stripes if asked (3D). */
export const drawMarkings = (ctx: Ctx, size: Size, stripes = 0) => {
  ctx.fillStyle = PITCH
  ctx.fillRect(0, 0, size.w, size.h)
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = STRIPES[i % 2]!
    ctx.fillRect((i * size.w) / stripes, 0, size.w / stripes + 1, size.h)
  }
  ctx.strokeStyle = LINE
  ctx.lineWidth = Math.max(1, size.w / 500)
  ctx.strokeRect(0, 0, size.w, size.h)
  const [mx] = toPx(size, 0, 0)
  ctx.beginPath()
  ctx.moveTo(mx, 0)
  ctx.lineTo(mx, size.h)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(mx, size.h / 2, (9.15 / LENGTH) * size.w, 0, Math.PI * 2)
  ctx.stroke()
  for (const s of [-1, 1]) {
    box(ctx, size, s * (LENGTH / 2), s * (LENGTH / 2 - 16.5), 20.16)
    box(ctx, size, s * (LENGTH / 2), s * (LENGTH / 2 - 5.5), 9.16)
  }
}

/**
 * The pitch with the frame's players in their kit colours and the ball (bigger when it is in the air). Given shirt
 * numbers (player id to number), the dots are a little bigger, outlined, and carry the number in black or white,
 * whichever reads on the kit.
 */
export const drawFrame = (ctx: Ctx, size: Size, frame: PitchFrame | null, kits: Kits, numbers?: ReadonlyMap<string, number>) => {
  drawMarkings(ctx, size)
  if (!frame) return
  const labelled = numbers !== undefined && numbers.size > 0 && typeof ctx.fillText === "function"
  const r = ((labelled ? 1.3 : 0.9) / LENGTH) * size.w
  for (const [side, colour] of [["home", kits.home], ["away", kits.away]] as const) {
    const ink = inkOn(colour)
    for (const p of frame[side]) {
      const [x, y] = toPx(size, p.x, p.y)
      ctx.fillStyle = colour
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fill()
      const n = labelled ? numbers.get(p.id) : undefined
      if (n === undefined) continue
      ctx.strokeStyle = ink === "#ffffff" ? "rgba(255,255,255,0.55)" : "rgba(11,17,32,0.55)"
      ctx.lineWidth = Math.max(1, r / 7)
      ctx.stroke()
      ctx.fillStyle = ink
      ctx.font = `700 ${Math.round(r * 1.05)}px Inter, system-ui, sans-serif`
      ctx.textAlign = "center"
      ctx.textBaseline = "middle"
      ctx.fillText!(String(n), x, y + r * 0.06)
    }
  }
  const [bx, by] = toPx(size, frame.ball.x, frame.ball.y)
  ctx.fillStyle = BALL
  ctx.beginPath()
  ctx.arc(bx, by, r * (0.5 + Math.min(1, frame.ball.z / 3) * 0.5), 0, Math.PI * 2)
  ctx.fill()
}
