/**
 * Team colours on screen. The league's kits are generated, so two clubs can turn up in near-identical blues, or a kit
 * can be pitch green. `teamColours` picks, for each side, the first of its kit's colours (primary, then secondary) that
 * stands out from the grass (and is not itself a green) and (for the away side) from the home colour; failing that, a fallback that always does.
 * Distances are CIE76 ΔE in Lab: crude, but enough to tell "the same blue" from "another colour".
 */
import type { MatchSummary } from "@touchline/rpc"

/** The grass the dots and bodies stand on (the 2D pitch's and the 3D stripes' greens). */
export const GRASS = ["#1f6b3a", "#2a723c", "#2f7d43"] as const
/** How far a team colour must be from every grass green. */
export const MIN_FROM_GRASS = 30
/** How far the away colour must be from the home colour. */
export const MIN_BETWEEN = 50
/** Colours that always stand out from the grass, tried in order when a kit's own do not. */
export const FALLBACKS = ["#f8fafc", "#111827", "#f59e0b", "#dc2626", "#7c3aed"] as const

const hex = (c: string): [number, number, number] | null => {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim())
  if (!m) return null
  const h = m[1]!.length === 3 ? [...m[1]!].map((d) => d + d).join("") : m[1]!
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number]
}

const linear = (v: number) => {
  const s = v / 255
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

const lab = (c: string): [number, number, number] | null => {
  const rgb = hex(c)
  if (!rgb) return null
  const [r, g, b] = rgb.map(linear) as [number, number, number]
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116)
  const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047)
  const y = f(0.2126 * r + 0.7152 * g + 0.0722 * b)
  const z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883)
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)]
}

/** CIE76 colour difference; Infinity when either is not a hex colour (so it never counts as "too close"). */
export const deltaE = (a: string, b: string): number => {
  const p = lab(a)
  const q = lab(b)
  return p && q ? Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) : Infinity
}

/** Green enough to read as grass whatever its lightness (lime dots on a green pitch): a Lab hue in this range, with colour. */
export const GREEN_HUES = [100, 170] as const
const greenish = ([, a, b]: [number, number, number]) => {
  const hue = (Math.atan2(b, a) * 180) / Math.PI
  return Math.hypot(a, b) > 15 && hue >= GREEN_HUES[0] && hue <= GREEN_HUES[1]
}
const offGrass = (c: string) => {
  const l = lab(c)
  return l !== null && !greenish(l) && GRASS.every((g) => deltaE(c, g) >= MIN_FROM_GRASS)
}

export interface KitColours {
  readonly primary: string
  readonly secondary: string
}

/** The two sides' on-screen colours: always distinct from the grass and from each other. */
export const teamColours = (home: KitColours, away: KitColours): { home: string; away: string } => {
  const h = [home.primary, home.secondary, ...FALLBACKS].find(offGrass) ?? FALLBACKS[0]
  const a = [away.primary, away.secondary, ...FALLBACKS].find((c) => offGrass(c) && deltaE(c, h) >= MIN_BETWEEN) ?? FALLBACKS[1]
  return { home: h, away: a }
}

/** Black or white, whichever reads better on the colour (a shirt number on a dot). */
export const inkOn = (c: string): string => {
  const rgb = hex(c)
  if (!rgb) return "#ffffff"
  const [r, g, b] = rgb.map(linear) as [number, number, number]
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
  // WCAG contrast against white vs against black.
  return 1.05 / (lum + 0.05) >= (lum + 0.05) / 0.05 ? "#ffffff" : "#0b1120"
}

/** The match with each side's kit primary swapped for its on-screen colour (everything downstream draws kit.primary). */
export const withTeamColours = <M extends Pick<MatchSummary, "home" | "away">>(m: M): M => {
  const c = teamColours(m.home.kit, m.away.kit)
  if (c.home === m.home.kit.primary && c.away === m.away.kit.primary) return m
  const recolour = <T extends M["home"]>(team: T, primary: string): T => (team.kit.primary === primary ? team : { ...team, kit: { ...team.kit, primary } })
  return { ...m, home: recolour(m.home, c.home), away: recolour(m.away, c.away) }
}
