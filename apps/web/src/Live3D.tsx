import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import type { MatchInfo, PitchFrame, Playback } from "@touchline/rpc"
import type { Cue } from "@touchline/schema"
import { t, type Key, type Lang } from "./i18n.js"
import type { Marker } from "./markers.js"
import { CAMERAS, type CameraKind } from "./view3d/cameras.js"
import { findKicks, type Kick } from "./view3d/kick.js"
import { LAYOUTS, type Layout, type Viewport } from "./view3d/layout.js"
import { LiveBuffer } from "./view3d/motion.js"
import { Stage3D, type Play } from "./view3d/Stage3D.js"
import type { StatTag } from "./tags.js"

export const CAMERA_KEY: Record<CameraKind, Key> = { follow: "camFollow", fp: "camFp", broadcast: "camBroadcast", tactical: "camTactical" }
const LAYOUT_KEY: Record<Layout, Key> = { pip: "layoutPip", grid: "layoutGrid", single: "layoutSingle" }

/** The players on the pitch in a frame, home first. */
const onPitch = (f: PitchFrame | null): string[] => (f ? [...f.home, ...f.away].map((p) => p.id) : [])

/** Who to follow when the 3D view opens: the player nearest the ball. */
export const nearestBall = (f: PitchFrame): string | null =>
  [...f.home, ...f.away].reduce<{ id: string | null; d: number }>((m, p) => {
    const d = Math.hypot(p.x - f.ball.x, p.y - f.ball.y)
    return d < m.d ? { id: p.id, d } : m
  }, { id: null, d: Infinity }).id

/** A row of toggle buttons, one pressed. */
export const Choice = <A extends string>({ label, options, value, onChange, name }: { label: string; options: ReadonlyArray<A>; value: A; onChange: (a: A) => void; name: (a: A) => string }) => (
  <div role="group" aria-label={label} className="flex gap-0.5 rounded bg-slate-800 p-0.5">
    {options.map((o) => (
      <button key={o} type="button" aria-pressed={o === value} className={`rounded px-2 py-1 text-sm ${o === value ? "bg-amber-400 text-slate-950" : "hover:bg-slate-700"}`} onClick={() => onChange(o)}>
        {name(o)}
      </button>
    ))}
  </div>
)

/**
 * The live match in 3D (Plan 7): the session's frames played a little behind on the 3D stage, with the camera, the
 * layout and the player followed chosen here (click a player, keys 1–4 and [ ]). `children` (the cue overlays) go on top.
 * While this viewer is `frozen` (on a match frame), `frame` is the frame frozen on and the bodies stand still. Pitch
 * markers (cues in the `pitch_marker` slot) are drawn on the pitch; tapping one calls `onMarkerTap`.
 */
export const Live3D = ({ match, frame, playback = null, lang, children, frozen = null, markers = [], onMarkerTap, tags = [] }: {
  match: MatchInfo
  frame: PitchFrame | null
  playback?: Playback | null
  lang: Lang
  children?: ReactNode
  frozen?: number | null
  markers?: ReadonlyArray<Cue>
  onMarkerTap?: (m: Marker, cue: Cue) => void
  /** Live stat tags over the players. */
  tags?: ReadonlyArray<StatTag>
}) => {
  const [camera, setCamera] = useState<CameraKind>("follow")
  const [layout, setLayout] = useState<Layout>("pip")
  const [followed, setFollowed] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const buffer = useMemo(() => new LiveBuffer(match.fps), [match])
  const kicks = useRef<{ upTo: number; list: ReadonlyArray<Kick> }>({ upTo: -1, list: [] })
  const names = useMemo(() => new Map(match.players.map((p) => [p.id, p])), [match])
  const who = (id: string) => {
    const p = names.get(id)
    return p ? `#${p.jersey} ${p.name}` : id
  }
  // Back to live from a freeze: start the buffer afresh, so motion (and kicks) do not run across the gap.
  const wasFrozen = useRef(false)
  useEffect(() => {
    if (wasFrozen.current && frozen === null) buffer.clear()
    wasFrozen.current = frozen !== null
    if (!frame) return
    buffer.push(frame, performance.now())
    if (followed === null) setFollowed(nearestBall(frame))
    else if (!onPitch(frame).includes(followed)) {
      // Substituted or sent off: the viewer is told why, the player nearest the ball is followed instead, and a camera
      // that was on the player hands over to the broadcast camera.
      setNotice(`${who(followed)} ${t(lang, "leftPitch")}`)
      setFollowed(nearestBall(frame))
      if (camera === "follow" || camera === "fp") setCamera("broadcast")
    }
  }, [frame, frozen])
  const ids = onPitch(frame)
  const step = (d: number) => {
    if (!ids.length) return
    const i = followed ? ids.indexOf(followed) : -1
    setFollowed(ids[(i + d + ids.length) % ids.length]!)
    setNotice(null)
  }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return
      if (e.key >= "1" && e.key <= "4") setCamera(CAMERAS[Number(e.key) - 1]!)
      if (e.key === "[") step(-1)
      if (e.key === "]") step(1)
    }
    window.addEventListener("keydown", key)
    return () => window.removeEventListener("keydown", key)
  })
  // Bodies animate at the session's speed (still while it is paused or this viewer is frozen), so their feet keep pace
  // with the positions.
  const speed = useRef(1)
  speed.current = frozen !== null ? 0 : playback ? (playback.state === "playing" ? playback.speed : 0) : 1
  const play: Play = useMemo(
    () => ({
      sample: (now) => buffer.sample(now),
      kicks: () => {
        const frames = buffer.frames
        const last = frames.at(-1)?.frame ?? -1
        if (last !== kicks.current.upTo) kicks.current = { upTo: last, list: findKicks(frames, match.fps) }
        return kicks.current.list
      },
      rate: () => speed.current
    }),
    [buffer, match.fps]
  )
  const label = (v: Viewport) => (v.inset ? t(lang, "map") : t(lang, CAMERA_KEY[v.camera]) + ((v.camera === "follow" || v.camera === "fp") && followed ? ` · ${who(followed)}` : ""))
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Choice label={t(lang, "camera")} options={CAMERAS} value={camera} onChange={(c) => (setCamera(c), setNotice(null))} name={(c) => t(lang, CAMERA_KEY[c])} />
        <Choice label={t(lang, "layout")} options={LAYOUTS} value={layout} onChange={setLayout} name={(l) => t(lang, LAYOUT_KEY[l])} />
        <label className="text-sm">
          {t(lang, "following")}{" "}
          <select aria-label={t(lang, "following")} className="rounded bg-slate-800 px-2 py-1" value={followed ?? ""} onChange={(e) => (setFollowed(e.target.value), setNotice(null))}>
            {ids.map((id) => <option key={id} value={id}>{who(id)}</option>)}
          </select>
        </label>
      </div>
      {notice && <p role="status" className="rounded bg-amber-900/60 px-3 py-1 text-sm">{notice}</p>}
      <div className="relative aspect-[16/9] w-full">
        <Stage3D match={match} plays={{ real: play }} mode="multi" layout={layout} camera={camera} followed={followed} onPick={(id) => (setFollowed(id), setNotice(null))} markers={{ cues: markers, onTap: (m, c) => onMarkerTap?.(m, c) }} tags={tags} label={label} loading={t(lang, "loading3d")} failed={t(lang, "failed3d")} />
        {children}
      </div>
      <p className="text-xs text-slate-400">{t(lang, "keysHint")}</p>
    </div>
  )
}
