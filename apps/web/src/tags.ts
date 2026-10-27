/**
 * Live stat tags: short, frame-anchored labels on the pitch. A sprinting player's name and speed, a shot's ball speed
 * (and xG for analysts), a pass's length and difficulty. They are worked out from what the pane has seen up to the
 * frame shown (the frozen one, if frozen), so they never tell what comes later; at most MAX_TAGS show, newest first,
 * each fading out at the end of its time. Pure, so it is tested; StatTags and StatTags3D draw them.
 */
import type { BallEvent, PitchFrame } from "@touchline/rpc"
import { t, type Lang } from "./i18n.js"
import type { ArrivedEvent } from "./pane.js"

/** A player faster than this (km/h, smoothed) gets a sprint tag. */
export const SPRINT_KMH = 25
/** Speeds are measured over this much match time (s), so one jumpy frame does not trigger a tag. */
export const SMOOTH_S = 0.5
/** Faster than this is a jump in the data (a substitution, a restart), not running. */
export const MAX_RUN_KMH = 45
/** How long a sprint tag stays after the sprint's fastest moment (s of match time). */
export const SPRINT_TAG_S = 2
/** How long an event tag stays (s of match time). */
export const EVENT_TAG_S = 3
/** At most this many tags at once; at most one of them a sprint. */
export const MAX_TAGS = 3
/** A completed pass this unlikely (xPass) is a "tough pass" for casual fans and a "hard pass" for analysts. */
export const DIFFICULT_XPASS = 0.35
/** An analyst sees a pass tag for passes at least this hard (xPass below) or this long (m). */
export const NOTABLE_XPASS = 0.6
export const NOTABLE_LENGTH_M = 25
/** The last part of a tag's time over which it fades out. */
const FADE_PART = 0.3

export type TagKind = "sprint" | "shot" | "pass"

export interface StatTag {
  readonly key: string
  readonly kind: TagKind
  /** The frame it is anchored on (the event's, or the sprint's fastest moment). */
  readonly frame: number
  readonly text: string
  /** Whom it is about (a sprint follows its runner), and where on the pitch it goes (PitchFrame metres). */
  readonly player_id: string | null
  readonly x: number
  readonly y: number
  readonly team: "home" | "away" | null
  /** 1 while fresh, down to 0 as it fades out. */
  readonly opacity: number
  /** A pass that was completed (true) or not (false); null for other tags. */
  readonly ok: boolean | null
}

const kmh1 = (v: number) => (Math.round(v * 10) / 10).toFixed(1)

/** The frames of `ring` at or before `at`, oldest first (the ring is kept in order). */
const upTo = (ring: ReadonlyArray<PitchFrame>, at: number): ReadonlyArray<PitchFrame> => {
  let n = ring.length
  while (n > 0 && ring[n - 1]!.frame > at) n--
  return n === ring.length ? ring : ring.slice(0, n)
}

/**
 * Each player's speed (km/h) at `frames[i]`, measured from the newest frame at least SMOOTH_S earlier in the same
 * period (and no more than twice that); players whose speed cannot be measured, or that jumped, are left out.
 */
export const speedsAt = (frames: ReadonlyArray<PitchFrame>, i: number, fps: number): Map<string, number> => {
  const out = new Map<string, number>()
  const f = frames[i]
  if (!f) return out
  const span = SMOOTH_S * fps
  let j = i - 1
  while (j >= 0 && f.frame - frames[j]!.frame < span) j--
  const g = frames[j]
  if (!g || g.period !== f.period || f.frame - g.frame > 2 * span) return out
  const dt = (f.frame - g.frame) / fps
  for (const side of ["home", "away"] as const) {
    const before = new Map(g[side].map((p) => [p.id, p]))
    for (const p of f[side]) {
      const q = before.get(p.id)
      if (!q) continue
      const v = (Math.hypot(p.x - q.x, p.y - q.y) / dt) * 3.6
      if (v <= MAX_RUN_KMH) out.set(p.id, v)
    }
  }
  return out
}

const opacityOf = (frame: number, ttl: number, at: number): number => {
  const left = frame + ttl - at
  return Math.max(0, Math.min(1, left / (ttl * FADE_PART)))
}

const where = (f: PitchFrame, id: string): { x: number; y: number; team: "home" | "away" } | null => {
  for (const side of ["home", "away"] as const) {
    const p = f[side].find((q) => q.id === id)
    if (p) return { x: p.x, y: p.y, team: side }
  }
  return null
}

/**
 * Sprint tags at frame `at`: every player who ran faster than SPRINT_KMH in the last SPRINT_TAG_S, with their top speed
 * then, anchored on that moment and placed where they are at `at`. Fastest first.
 */
export const sprintTags = (ring: ReadonlyArray<PitchFrame>, at: number, fps: number, names: Readonly<Record<string, string>>): StatTag[] => {
  const frames = upTo(ring, at)
  const now = frames.at(-1)
  if (!now) return []
  const ttl = SPRINT_TAG_S * fps
  const peak = new Map<string, { v: number; frame: number }>()
  for (let i = frames.length - 1; i >= 0 && frames[i]!.frame > at - ttl; i--) {
    for (const [id, v] of speedsAt(frames, i, fps)) {
      if (v < SPRINT_KMH) continue
      const seen = peak.get(id)
      if (!seen || v > seen.v) peak.set(id, { v, frame: frames[i]!.frame })
    }
  }
  return [...peak]
    .flatMap(([id, p]) => {
      const pos = where(now, id)
      if (!pos) return []
      return [{ key: `sprint-${id}`, kind: "sprint" as const, frame: p.frame, text: `${names[id] ?? id} · ${kmh1(p.v)} km/h`, player_id: id, ...pos, opacity: opacityOf(p.frame, ttl, at), ok: null, v: p.v }]
    })
    .sort((a, b) => b.v - a.v)
    .map(({ v: _, ...tag }) => tag)
}

const pct = (v: number) => `${Math.round(v * 100)}%`

/** A pass's tag text for a mode, or null when the pass is not worth a tag for it. */
export const passText = (e: BallEvent, mode: "casual" | "analyst", lang: Lang): string | null => {
  const ok = e.outcome === "success"
  if (mode === "casual") return ok && e.xpass !== null && e.xpass < DIFFICULT_XPASS ? t(lang, "tagToughPass") : null
  const notable = (e.xpass !== null && e.xpass < NOTABLE_XPASS) || (e.length_m !== null && e.length_m >= NOTABLE_LENGTH_M)
  if (!notable) return null
  const label = e.xpass === null ? t(lang, "tagPass") : e.xpass < DIFFICULT_XPASS ? t(lang, "tagHardPass") : e.xpass < NOTABLE_XPASS ? t(lang, "tagTrickyPass") : t(lang, "tagPass")
  return [label, e.length_m !== null ? `${Math.round(e.length_m)} m` : null, e.xpass !== null ? `${pct(e.xpass)} xPass` : null].filter(Boolean).join(" · ") + (ok ? " ✓" : " ✗")
}

/** A shot's tag text for a mode. */
export const shotText = (e: BallEvent, mode: "casual" | "analyst", lang: Lang): string => {
  const speed = e.speed_kmh === null ? null : Math.round(e.speed_kmh)
  if (mode === "casual") return speed === null ? `${t(lang, "tagShot")}!` : t(lang, "tagRocket").replace("{kmh}", String(speed))
  return [t(lang, "tagShot"), speed === null ? null : `${speed} km/h`, e.xg === null ? null : `xG ${e.xg.toFixed(2)}`].filter(Boolean).join(" · ")
}

/**
 * Event tags at frame `at`: shots, and the passes the mode cares about, from the last EVENT_TAG_S. `frozen`: the frame
 * this view froze on, so an event that arrived after it stays off (no spoilers). Newest first.
 */
export const eventTags = (events: ReadonlyArray<ArrivedEvent>, at: number, fps: number, mode: "casual" | "analyst", lang: Lang, frozen: number | null = null): StatTag[] => {
  const ttl = EVENT_TAG_S * fps
  const out: StatTag[] = []
  for (const { event: e, arrivedAt } of events) {
    if (e.frame > at || e.frame <= at - ttl || (frozen !== null && arrivedAt > frozen)) continue
    const text = e.type === "shot" ? shotText(e, mode, lang) : e.type === "pass" ? passText(e, mode, lang) : null
    if (text === null) continue
    const end = e.type === "pass" && e.x_end !== null && e.y_end !== null
    out.push({
      key: `event-${e.id}`, kind: e.type === "shot" ? "shot" : "pass", frame: e.frame, text, player_id: e.type === "pass" ? (e.outcome === "success" ? e.receiver_id : null) : e.player_id,
      x: end ? e.x_end! : e.x, y: end ? e.y_end! : e.y, team: e.team, opacity: opacityOf(e.frame, ttl, at), ok: e.type === "pass" ? e.outcome === "success" : null
    })
  }
  return out.sort((a, b) => b.frame - a.frame)
}

/** The tags to show: newest first, at most MAX_TAGS, of which at most one sprint (the fastest). */
export const selectTags = (events: ReadonlyArray<StatTag>, sprints: ReadonlyArray<StatTag>): StatTag[] =>
  [...events, ...sprints.slice(0, 1)].sort((a, b) => b.frame - a.frame || (a.kind === "sprint" ? 1 : 0) - (b.kind === "sprint" ? 1 : 0)).slice(0, MAX_TAGS)

/** Every tag a pane shows at frame `at` (the frozen frame when frozen). */
export const statTags = (o: {
  readonly ring: ReadonlyArray<PitchFrame>
  readonly events: ReadonlyArray<ArrivedEvent>
  readonly at: number
  readonly frozen: number | null
  readonly fps: number
  readonly mode: "casual" | "analyst"
  readonly lang: Lang
  readonly names: Readonly<Record<string, string>>
}): StatTag[] => selectTags(eventTags(o.events, o.at, o.fps, o.mode, o.lang, o.frozen), sprintTags(o.ring, o.at, o.fps, o.names))
