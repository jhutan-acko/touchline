import type { Segment } from "@touchline/schema"
import type { Lang } from "./i18n.js"

/** A viewer's profile (spec §5.5). Profiles collapse to segments, so cues are written per segment, not per viewer. */
export interface Profile {
  readonly mode: "casual" | "analyst"
  readonly lang: Lang
  /** Clubs the viewer supports, most supported first (the first frames the casual text). */
  readonly clubs: ReadonlyArray<string>
}

export const segmentOf = (p: Profile): Segment => ({ mode: p.mode, lang: p.lang, club: p.clubs[0] ?? null })

/** Ready-made profiles for the switcher; `club: "home"` / `"away"` stand for the match's two clubs. */
export const PRESETS: ReadonlyArray<{ readonly id: string; readonly mode: Profile["mode"]; readonly lang: Lang; readonly club: "home" | "away" | null }> = [
  { id: "casual-en", mode: "casual", lang: "en", club: null },
  { id: "home-fan-en", mode: "casual", lang: "en", club: "home" },
  { id: "analyst-en", mode: "analyst", lang: "en", club: null },
  { id: "casual-es", mode: "casual", lang: "es", club: null },
  { id: "analyst-es", mode: "analyst", lang: "es", club: null },
  { id: "casual-hi", mode: "casual", lang: "hi", club: null },
  { id: "analyst-hi", mode: "analyst", lang: "hi", club: null }
]

export const presetProfile = (id: string, home: string, away: string): Profile => {
  const p = PRESETS.find((x) => x.id === id) ?? PRESETS[0]!
  return { mode: p.mode, lang: p.lang, clubs: p.club === "home" ? [home] : p.club === "away" ? [away] : [] }
}
