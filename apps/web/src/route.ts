/**
 * The app's pages, in the URL hash so each opens in its own tab or window: the fan app (`#/`), and for a session the
 * studio console (`#/studio/<session>?seg=…`), the broadcast graphics output (`#/graphics/<session>?seg=…&match=…`,
 * for a vision mixer or OBS; the match names the teams) and the ops view (`#/ops/<session>?lang=…`). `seg` is a segment key:
 * mode.lang.club, `neutral` for none.
 */
import type { Segment } from "@touchline/schema"
import type { Lang } from "./i18n.js"

export type Route =
  | { readonly page: "fan" }
  | { readonly page: "studio"; readonly session: string; readonly segment: Segment }
  | { readonly page: "graphics"; readonly session: string; readonly segment: Segment; readonly match: string }
  | { readonly page: "ops"; readonly session: string; readonly lang: Lang }

const DEFAULT_SEGMENT: Segment = { mode: "casual", lang: "en", club: null }

const parseSegment = (key: string | null): Segment => {
  const [mode, lang, ...club] = (key ?? "").split(".")
  if ((mode !== "casual" && mode !== "analyst") || (lang !== "en" && lang !== "es" && lang !== "hi")) return DEFAULT_SEGMENT
  const c = club.join(".")
  return { mode, lang, club: c && c !== "neutral" ? c : null }
}

export const segmentParam = (s: Segment): string => `${s.mode}.${s.lang}.${s.club ?? "neutral"}`

export const parseRoute = (hash: string): Route => {
  const [path = "", query = ""] = hash.replace(/^#/, "").split("?")
  const [, page, session] = path.split("/")
  if (!session) return { page: "fan" }
  const id = decodeURIComponent(session)
  const q = new URLSearchParams(query)
  const lang = q.get("lang")
  if (page === "ops") return { page, session: id, lang: lang === "es" || lang === "hi" ? lang : "en" }
  if (page === "studio") return { page, session: id, segment: parseSegment(q.get("seg")) }
  const match = q.get("match")
  if (page === "graphics" && match) return { page, session: id, segment: parseSegment(q.get("seg")), match }
  return { page: "fan" }
}

export const routeHash = (r: Route): string => {
  if (r.page === "fan") return "#/"
  const base = `#/${r.page}/${encodeURIComponent(r.session)}`
  if (r.page === "ops") return `${base}?lang=${r.lang}`
  const seg = `${base}?seg=${segmentParam(r.segment)}`
  return r.page === "graphics" ? `${seg}&match=${encodeURIComponent(r.match)}` : seg
}
