import { useEffect, useRef } from "react"
import type { PitchFrame } from "@touchline/rpc"
import { drawFrame, type Kits } from "./draw.js"

const W = 1050
const H = 680

/** The match on a canvas, redrawn on every frame. */
export const Pitch = ({ frame, kits, label }: { frame: PitchFrame | null; kits: Kits; label: string }) => {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const ctx = ref.current?.getContext("2d")
    if (ctx) drawFrame(ctx, { w: W, h: H }, frame, kits)
  }, [frame, kits])
  return <canvas ref={ref} width={W} height={H} role="img" aria-label={label} data-frame={frame?.frame} className="aspect-[105/68] w-full rounded-lg" />
}
