import { describe, expect, it } from "vitest"
import type { PitchFrame } from "@touchline/rpc"
import { drawFrame, toPx } from "../src/draw.js"

/** A 2D context that records what is drawn, in which colour. */
const recorder = () => {
  const dots: Array<{ x: number; y: number; r: number; colour: string }> = []
  const ctx = {
    fillStyle: "" as unknown, strokeStyle: "" as unknown, lineWidth: 1,
    fillRect: () => {}, strokeRect: () => {}, beginPath: () => {}, moveTo: () => {}, lineTo: () => {}, stroke: () => {},
    arc(x: number, y: number, r: number) { last = { x, y, r } },
    fill() { if (last) dots.push({ ...last, colour: String(ctx.fillStyle) }); last = null }
  }
  let last: { x: number; y: number; r: number } | null = null
  return { ctx: ctx as unknown as Parameters<typeof drawFrame>[0], dots }
}

const frame = (ballZ = 0): PitchFrame => ({
  frame: 1, period: "first_half", clock: "00:00.10", ball: { x: 0, y: 0, z: ballZ },
  home: Array.from({ length: 11 }, (_, i) => ({ id: `h${i}`, x: -40 + i * 3, y: i - 5 })),
  away: Array.from({ length: 11 }, (_, i) => ({ id: `a${i}`, x: 40 - i * 3, y: 5 - i }))
})

describe("pitch drawing", () => {
  it("maps the pitch's corners and centre to the canvas", () => {
    const size = { w: 1050, h: 680 }
    expect(toPx(size, -52.5, 34)).toEqual([0, 0])
    expect(toPx(size, 52.5, -34)).toEqual([1050, 680])
    expect(toPx(size, 0, 0)).toEqual([525, 340])
  })

  it("draws every player in their kit colour, then the ball, bigger in the air", () => {
    const { ctx, dots } = recorder()
    drawFrame(ctx, { w: 1050, h: 680 }, frame(), { home: "#1d4ed8", away: "#dc2626" })
    expect(dots.filter((d) => d.colour === "#1d4ed8")).toHaveLength(11)
    expect(dots.filter((d) => d.colour === "#dc2626")).toHaveLength(11)
    const ball = dots.at(-1)!
    expect([ball.colour, ball.x, ball.y]).toEqual(["#ffffff", 525, 340])
    const high = recorder()
    drawFrame(high.ctx, { w: 1050, h: 680 }, frame(3), { home: "#1d4ed8", away: "#dc2626" })
    expect(high.dots.at(-1)!.r).toBeGreaterThan(ball.r)
  })

  it("draws only the markings before the first frame", () => {
    const { ctx, dots } = recorder()
    drawFrame(ctx, { w: 1050, h: 680 }, null, { home: "#000", away: "#fff" })
    expect(dots).toEqual([])
  })
})
