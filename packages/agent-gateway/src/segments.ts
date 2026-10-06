import { MAX_SEGMENTS, type Segment } from "@touchline/schema"

export class SegmentError extends Error {}

/** Parse "casual.en.neutral,analyst.es.ironmoor" (mode.lang.club, `neutral` for no club) into segments. */
export const parseSegments = (text: string): Segment[] => {
  const keys = text.split(",").map((s) => s.trim()).filter((s) => s !== "")
  if (keys.length === 0) throw new SegmentError("--segments needs at least one segment (mode.lang.club)")
  if (keys.length > MAX_SEGMENTS) throw new SegmentError(`--segments: at most ${MAX_SEGMENTS} segments, got ${keys.length}`)
  return keys.map((k) => {
    const [mode, lang, club, ...rest] = k.split(".")
    if (rest.length || (mode !== "casual" && mode !== "analyst") || (lang !== "en" && lang !== "es" && lang !== "hi") || !club)
      throw new SegmentError(`--segments: "${k}" is not mode.lang.club (mode casual or analyst, lang en, es or hi, club an id or neutral)`)
    return { mode, lang, club: club === "neutral" ? null : club }
  })
}
