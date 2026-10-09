import { useEffect, useMemo, useRef, useState } from "react"
import type { MatchInfo, WhatIfClip } from "@touchline/rpc"
import type { TouchlineClient } from "./client.js"
import { t, type Lang } from "./i18n.js"
import { CAMERA_KEY, Choice } from "./Live3D.js"
import { CAMERAS, type CameraKind } from "./view3d/cameras.js"
import { advance, isSlow, loopStart } from "./view3d/clipclock.js"
import { findKicks } from "./view3d/kick.js"
import type { Viewport } from "./view3d/layout.js"
import { sampleClip } from "./view3d/motion.js"
import { Stage3D, type Play } from "./view3d/Stage3D.js"

/** How long the pass lines stay on the grass after the pass (seconds of the clip). */
const LINE_S = 1.5
/** The flash when the plays split. */
const FLASH_S = 0.6

type State = { readonly kind: "loading"; readonly slow: boolean } | { readonly kind: "failed" | "best" | "unverified" } | { readonly kind: "ready"; readonly clip: WhatIfClip }

/**
 * The what-if split (Plan 7): the pass as it went on the left, the better pass played out on the right (its typical
 * re-simulation), one clock and one camera for both, and the verified numbers underneath. Only this viewer leaves
 * the live match; "Back to live" returns to it.
 */
export const WhatIfSplit = ({ client, sessionId, eventId, match, lang, onClose }: { client: TouchlineClient; sessionId: string; eventId: string; match: MatchInfo; lang: Lang; onClose: () => void }) => {
  const [state, setState] = useState<State>({ kind: "loading", slow: false })
  const [camera, setCamera] = useState<CameraKind>("follow")
  const [playing, setPlaying] = useState(true)
  const [shown, setShown] = useState(0)
  const f = useRef(0)
  useEffect(() => {
    let live = true
    // A cached clip comes at once; say what is happening only when it is being computed.
    const slow = setTimeout(() => live && setState((s) => (s.kind === "loading" ? { kind: "loading", slow: true } : s)), 300)
    client.whatIf(sessionId, eventId).then(
      (clip) => {
        if (!live) return
        if (clip.verdict === "better_option_found" && clip.variant) {
          f.current = loopStart({ fps: clip.fps, passIndex: clip.pass_index, length: clip.real.length })
          setState({ kind: "ready", clip })
        } else setState({ kind: clip.verdict === "played_pass_was_best" ? "best" : "unverified" })
      },
      () => live && setState({ kind: "failed" })
    )
    return () => {
      live = false
      clearTimeout(slow)
    }
  }, [client, sessionId, eventId])
  const clip = state.kind === "ready" ? state.clip : null
  const timing = clip ? { fps: clip.fps, passIndex: clip.pass_index, length: clip.real.length } : null
  // The clock: advanced every animation frame, shown to React a few times a second.
  useEffect(() => {
    if (!timing || !playing) return
    let last = performance.now()
    let id = 0
    const tick = (now: number) => {
      f.current = advance(timing, f.current, Math.min(0.05, (now - last) / 1000), 1)
      last = now
      setShown(Math.round(f.current * 4) / 4)
      id = requestAnimationFrame(tick)
    }
    id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(id)
  }, [clip, playing])
  const plays = useMemo(() => {
    if (!clip || !clip.variant) return null
    const play = (frames: WhatIfClip["real"]): Play => {
      const kicks = findKicks(frames, clip.fps)
      return { sample: () => sampleClip(frames, f.current, clip.fps), kicks: () => kicks, rate: () => (playing ? (isSlow(timing!, f.current) ? 0.5 : 1) : 0) }
    }
    return { real: play(clip.real), variant: play(clip.variant) }
  }, [clip, playing])
  const who = (id: string | null) => {
    const p = match.players.find((x) => x.id === id)
    return p ? `#${p.jersey} ${p.name}` : ""
  }
  const back = <button type="button" className="rounded bg-emerald-600 px-3 py-1 text-white" onClick={onClose}>{t(lang, "backToLive")}</button>
  if (!clip || !plays || !timing) {
    const message = state.kind === "loading" ? (state.slow ? t(lang, "resimulating") : "") : t(lang, state.kind === "failed" ? "whatIfFailed" : state.kind === "best" ? "bestPlayed" : "notVerified")
    return (
      <section aria-label={t(lang, "whatIf")} className="flex flex-col items-start gap-3 rounded-lg bg-slate-900 p-4">
        <p role="status">{message}</p>
        {back}
      </section>
    )
  }
  const sinceS = (shown - clip.pass_index) / clip.fps
  const lines = sinceS >= -0.1 && sinceS < LINE_S
  const label = (v: Viewport) => (v.world === "real" ? `${t(lang, "whatHappened")} · ${t(lang, "passTo")} ${who(clip.played_to)}` : `${t(lang, "whatIf")} · ${t(lang, "passTo")} ${who(clip.better_to)}`)
  const n = clip.seeds
  return (
    <section aria-label={t(lang, "whatIf")} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {back}
        <button type="button" className="rounded bg-slate-800 px-3 py-1" onClick={() => setPlaying(!playing)}>{playing ? t(lang, "pause") : t(lang, "play")}</button>
        <Choice label={t(lang, "camera")} options={CAMERAS} value={camera} onChange={setCamera} name={(c) => t(lang, CAMERA_KEY[c])} />
        <input type="range" aria-label={t(lang, "whatIf")} className="min-w-40 flex-1 accent-amber-400" min={0} max={clip.real.length - 1} step={0.1} value={shown}
          onChange={(e) => { f.current = Number(e.target.value); setShown(f.current) }} />
        <span className="tabular-nums text-sm text-slate-400">{sinceS >= 0 ? "+" : "−"}{Math.abs(sinceS).toFixed(1)} s</span>
      </div>
      <div className="relative aspect-[16/9] w-full">
        <Stage3D match={match} plays={plays} mode="split" layout="single" camera={camera} followed={clip.passer_id} label={label} loading={t(lang, "loading3d")} failed={t(lang, "failed3d")}
          lines={lines ? { real: { from: clip.passer_id, to: clip.played_to, colour: "#f07167" }, variant: { from: clip.passer_id, to: clip.better_to!, colour: "#5fd38d" } } : {}} />
        <div data-testid="flash" className={`pointer-events-none absolute inset-0 rounded-lg ring-4 ring-amber-400 transition-opacity duration-300 ${sinceS >= 0 && sinceS < FLASH_S ? "opacity-100" : "opacity-0"}`} />
      </div>
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 rounded-lg bg-slate-900 px-4 py-2" data-testid="evidence-strip">
        <span className="text-xl font-bold tabular-nums"><span className="text-emerald-400">{clip.shots!.better} / {n}</span> vs <span className="text-rose-400">{clip.shots!.played} / {n}</span></span>
        <span className="text-sm">{t(lang, "shotsWithin")} {clip.horizon_s} s</span>
        <span className="text-sm tabular-nums">{t(lang, "goals")}: {clip.goals!.better} vs {clip.goals!.played}</span>
        <span className="text-sm tabular-nums">{t(lang, "gain")}: {clip.gain!.mean >= 0 ? "+" : "−"}{Math.abs(clip.gain!.mean).toFixed(2)} ± {clip.gain!.se.toFixed(2)}</span>
        <span className="text-xs text-slate-400">{t(lang, "typical").replace("{k}", String(clip.typical_seed))} · {t(lang, "verified")}</span>
      </div>
    </section>
  )
}
