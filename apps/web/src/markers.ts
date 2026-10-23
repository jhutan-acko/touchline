/**
 * Pitch markers (pause and ask): cues in the `pitch_marker` slot drawn on the 3D pitch. The convention, shared with the
 * agents that write them: the template names the shape, players are `data` keys with value 1 (`at:<id>` for a ring or
 * ghost, `from:<id>` and `to:<id>` for an arc's ends), and numbers are `data` values (`count` pressers; `x`, `y` a
 * ghost's point in pitch metres, as in PitchFrame). Pure, so it is tested without a GPU.
 */
import type { Cue } from "@touchline/schema"

export const TEMPLATES = ["pressure_ring", "pass_arc", "ghost"] as const
export type MarkerTemplate = (typeof TEMPLATES)[number]

export interface Marker {
  readonly template: MarkerTemplate
  readonly at?: string
  readonly from?: string
  readonly to?: string
  readonly count?: number
  readonly point?: { readonly x: number; readonly y: number }
}

/** A pressure ring's radius around the player's feet, in metres. */
export const RING_RADIUS = 1.5
/** A ghost circle's radius, in metres. */
export const GHOST_RADIUS = 1
/** An arc's height at its middle: this share of its length, at most ARC_MAX_HEIGHT metres. */
export const ARC_RISE = 0.25
export const ARC_MAX_HEIGHT = 6
/** Markers sit this far above the grass (metres), clear of the pitch markings. */
export const LIFT = 0.1

const isTemplate = (t: string): t is MarkerTemplate => (TEMPLATES as ReadonlyArray<string>).includes(t)

/** The player a `data` key names (`<role>:<id>` with value 1). */
const player = (data: Cue["data"], role: "at" | "from" | "to"): string | undefined => {
  const key = Object.keys(data).find((k) => k.startsWith(`${role}:`) && data[k] === 1)
  return key?.slice(role.length + 1)
}

/** The marker a cue draws, or null when it is not a pitch marker, its template is unknown, or it lacks the players or point it needs. */
export const parseMarker = (cue: Cue): Marker | null => {
  if (cue.display.slot !== "pitch_marker" || !isTemplate(cue.display.template)) return null
  const d = cue.data
  const at = player(d, "at")
  const from = player(d, "from")
  const to = player(d, "to")
  const point = d.x !== undefined && d.y !== undefined ? { x: d.x, y: d.y } : undefined
  const m: Marker = {
    template: cue.display.template,
    ...(at !== undefined ? { at } : {}),
    ...(from !== undefined ? { from } : {}),
    ...(to !== undefined ? { to } : {}),
    ...(d.count !== undefined ? { count: d.count } : {}),
    ...(point ? { point } : {})
  }
  switch (m.template) {
    case "pressure_ring":
      return m.at ? m : null
    case "pass_arc":
      return m.from && m.to ? m : null
    case "ghost":
      return m.at || m.point ? m : null
  }
}

type P3 = { readonly x: number; readonly y: number; readonly z: number }

/** A point `u` (0 to 1) along the raised arc between two world positions (x along, y up, z across). */
export const arcPoint = (a: P3, b: P3, u: number): [number, number, number] => {
  const h = Math.min(ARC_MAX_HEIGHT, ARC_RISE * Math.hypot(b.x - a.x, b.z - a.z))
  return [a.x + (b.x - a.x) * u, LIFT + 4 * h * u * (1 - u), a.z + (b.z - a.z) * u]
}
