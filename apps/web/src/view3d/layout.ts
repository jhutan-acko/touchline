/**
 * Where each camera goes on the one 3D canvas (Plan 7), pure: main + map, a 2×2 grid, a single view, or the what-if
 * split. Pixels from the canvas's top left. Narrow screens get one view (split halves stack).
 */
import { CAMERAS, type CameraKind } from "./cameras.js"

export type Layout = "pip" | "grid" | "single"
export const LAYOUTS: ReadonlyArray<Layout> = ["pip", "grid", "single"]
/** Below this canvas width only one view fits (and split halves stack). */
export const NARROW_PX = 768

export interface Viewport {
  readonly key: string
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  /** Which play it shows: the match as it went, or the what-if variant. */
  readonly world: "real" | "variant"
  readonly camera: CameraKind
  /** The mini-map in a corner (drawn last, on top). */
  readonly inset: boolean
}

export interface LayoutOptions {
  readonly mode: "multi" | "split"
  readonly layout: Layout
  readonly camera: CameraKind
  readonly w: number
  readonly h: number
}

const vp = (key: string, x: number, y: number, w: number, h: number, world: Viewport["world"], camera: CameraKind, inset = false): Viewport => ({ key, x, y, w, h, world, camera, inset })

export const viewports = (o: LayoutOptions): Viewport[] => {
  const { w, h } = o
  const narrow = w < NARROW_PX
  if (o.mode === "split") {
    return narrow
      ? [vp("real", 0, 0, w, h / 2, "real", o.camera), vp("variant", 0, h / 2, w, h / 2, "variant", o.camera)]
      : [vp("real", 0, 0, w / 2, h, "real", o.camera), vp("variant", w / 2, 0, w / 2, h, "variant", o.camera)]
  }
  if (o.layout === "grid" && !narrow) return CAMERAS.map((c, i) => vp(`grid-${c}`, (i % 2) * (w / 2), Math.floor(i / 2) * (h / 2), w / 2, h / 2, "real", c))
  const main = vp(`main-${o.camera}`, 0, 0, w, h, "real", o.camera)
  if (o.layout === "single" || narrow || o.camera === "tactical") return [main]
  const mw = Math.max(170, w * 0.26)
  const mh = (mw * 68) / 105
  return [main, vp("map", w - mw - 12, h - mh - 12, mw, mh, "real", "tactical", true)]
}

/** The viewport under a point (the inset first: it is on top). */
export const viewportAt = (vps: ReadonlyArray<Viewport>, x: number, y: number): Viewport | null =>
  [...vps].reverse().find((v) => x >= v.x && x <= v.x + v.w && y >= v.y && y <= v.y + v.h) ?? null

/** The id of the point nearest a click on screen, within `maxPx`. */
export const nearestOnScreen = (points: ReadonlyArray<{ readonly id: string; readonly sx: number; readonly sy: number }>, x: number, y: number, maxPx = 50): string | null => {
  let best: string | null = null
  let bd = maxPx
  for (const p of points) {
    const d = Math.hypot(p.sx - x, p.sy - y)
    if (d < bd) {
      bd = d
      best = p.id
    }
  }
  return best
}
