import { segmentKey, type Cue, type Segment } from "@touchline/schema"

/**
 * Which cached variant a segment is shown when the cache has none for it exactly: the same mode and language
 * without club framing, then English in the same mode (for its club, then neutral). Never another club's framing.
 */
export const preference = (s: Segment): string[] => [
  ...new Set([
    segmentKey(s),
    segmentKey({ ...s, club: null }),
    segmentKey({ ...s, lang: "en" }),
    segmentKey({ ...s, lang: "en", club: null })
  ])
]

/**
 * One cue per moment or recap for `segment` (the best variant the cache has), in anchor order. A moment's pitch-marker
 * cue (the overlay the agents draw with it) is picked on its own, so it does not compete with the text cue.
 */
export const pickCues = (cues: ReadonlyArray<Cue>, segment: Segment): Cue[] => {
  const order = preference(segment)
  const best = new Map<string, { cue: Cue; rank: number }>()
  for (const cue of cues) {
    if (cue.moment_id === null) continue
    const rank = order.indexOf(segmentKey(cue.segment))
    if (rank < 0) continue
    const key = cue.display.slot === "pitch_marker" ? `${cue.moment_id}:marker` : cue.moment_id
    const seen = best.get(key)
    if (!seen || rank < seen.rank) best.set(key, { cue, rank })
  }
  return [...best.values()].map((b) => b.cue).sort((a, b) => a.anchor.frame_to - b.anchor.frame_to || a.cue_id.localeCompare(b.cue_id))
}
