import { useEffect, useRef } from "react"
import type { PitchFrame } from "@touchline/rpc"
import { drawFocus, drawFrame, type Focus, type Kits } from "./draw.js"

const W = 1050
const H = 680

/** The match on a canvas, redrawn on every frame; with shirt numbers on the dots when given them, and the followed player (`focus`) ringed and named. */
export const Pitch = ({ frame, kits, label, numbers, focus = null }: { frame: PitchFrame | null; kits: Kits; label: string; numbers?: ReadonlyMap<string, number>; focus?: Focus | null }) => {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const ctx = ref.current?.getContext("2d")
    if (!ctx) return
    drawFrame(ctx, { w: W, h: H }, frame, kits, numbers)
    drawFocus(ctx, { w: W, h: H }, frame, focus)
  }, [frame, kits, numbers, focus?.id, focus?.label])
  return <canvas ref={ref} width={W} height={H} role="img" aria-label={label} data-frame={frame?.frame} data-focus={focus?.id} className="aspect-[105/68] w-full rounded-lg" />
}
