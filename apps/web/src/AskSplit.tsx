import { useEffect, useMemo, useRef, useState } from "react"
import type { AskClip, MatchInfo, PitchFrame } from "@touchline/rpc"
import { VERDICT_KEY } from "./AskPanel.js"
import type { TouchlineClient } from "./client.js"
import { t, type Lang } from "./i18n.js"
import { CAMERA_KEY, Choice } from "./Live3D.js"
import { CAMERAS, type CameraKind } from "./view3d/cameras.js"
import { advance, isSlow, loopStart } from "./view3d/clipclock.js"
import { findKicks } from "./view3d/kick.js"
import type { Viewport } from "./view3d/layout.js"
import { sampleClip } from "./view3d/motion.js"
import { Stage3D, type Play } from "./view3d/Stage3D.js"

type State = { readonly kind: "loading" | "failed" } | { readonly kind: "ready"; readonly clip: AskClip; readonly real: ReadonlyArray<PitchFrame>; readonly variant: ReadonlyArray<PitchFrame> }

/**
 * Show me, without spoilers: the alternative an answer re-simulated on the right, played on from the fork for the
 * whole horizon, and the match as it went on the left, only up to the frame the viewer paused on, where it holds
 * ("You paused here"). One clock and one camera for both, and the counts over the seeds underneath.
 */
export const AskSplit = ({ client, sessionId, clipId, match, lang, onClose }: { client: TouchlineClient; sessionId: string; clipId: string; match: MatchInfo; lang: Lang; onClose: () => void }) => {
  const [state, setState] = useState<State>({ kind: "loading" })
  const [camera, setCamera] = useState<CameraKind>("follow")
  const [playing, setPlaying] = useState(true)
  const [shown, setShown] = useState(0)
  const f = useRef(0)
  useEffect(() => {
    let live = true
    client.askClip(sessionId, clipId).then(
      (clip) => {
        if (!live) return
        if (!clip.variant || clip.variant.length === 0) return setState({ kind: "failed" })
        // The server cuts the real frames at the pause; cut again here, so nothing after it can ever be drawn.
        const real = clip.real.filter((fr) => fr.frame <= clip.paused_frame)
        if (real.length === 0) return setState({ kind: "failed" })
        setState({ kind: "ready", clip, real, variant: clip.variant })
      },
      () => live && setState({ kind: "failed" })
    )
    return () => void (live = false)
  }, [client, sessionId, clipId])
  const ready = state.kind === "ready" ? state : null
  const timing = useMemo(() => {
    if (!ready) return null
    const fork = ready.variant.findIndex((fr) => fr.frame >= ready.clip.fork_frame)
    return { fps: ready.clip.fps, passIndex: Math.max(0, fork), length: ready.variant.length }
  }, [ready])
  useEffect(() => {
    if (timing) f.current = loopStart(timing)
    setShown(f.current)
  }, [timing])
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
  }, [timing, playing])
  const plays = useMemo(() => {
    if (!ready || !timing) return null
    const play = (frames: ReadonlyArray<PitchFrame>): Play => {
      const kicks = findKicks(frames, ready.clip.fps)
      // Past its last frame a play holds there (the real side, at the pause), with the bodies still.
      const at = () => Math.min(f.current, frames.length - 1)
      return { sample: () => sampleClip(frames, at(), ready.clip.fps), kicks: () => kicks, rate: () => (playing && f.current < frames.length - 1 ? (isSlow(timing, f.current) ? 0.5 : 1) : 0) }
    }
    return { real: play(ready.real), variant: play(ready.variant) }
  }, [ready, timing, playing])
  const who = (id: string) => {
    const p = match.players.find((x) => x.id === id)
    return p ? `#${p.jersey} ${p.name}` : id
  }
  const back = <button type="button" className="rounded bg-emerald-600 px-3 py-1 text-white" onClick={onClose}>{t(lang, "backToLive")}</button>
  if (!ready || !plays || !timing) {
    return (
      <section aria-label={t(lang, "whatIf")} className="flex flex-col items-start gap-3 rounded-lg bg-slate-900 p-4">
        <p role="status">{state.kind === "failed" ? t(lang, "whatIfFailed") : t(lang, "resimulating")}</p>
        {back}
      </section>
    )
  }
  const { clip } = ready
  const held = shown >= ready.real.length - 1
  const alternative = clip.intervention.kind === "pass_to" ? `${t(lang, "passTo")} ${who(clip.intervention.receiver_id)}` : t(lang, "askMoved").replace("{name}", who(clip.intervention.player_id))
  const label = (v: Viewport) => (v.world === "real" ? `${t(lang, "whatHappened")}${held ? ` · ${t(lang, "pausedHere")}` : ""}` : `${t(lang, "whatIf")} · ${alternative}`)
  const sinceS = (shown - timing.passIndex) / clip.fps
  const n = clip.seeds
  return (
    <section aria-label={t(lang, "whatIf")} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {back}
        <button type="button" className="rounded bg-slate-800 px-3 py-1" onClick={() => setPlaying(!playing)}>{playing ? t(lang, "pause") : t(lang, "play")}</button>
        <Choice label={t(lang, "camera")} options={CAMERAS} value={camera} onChange={setCamera} name={(c) => t(lang, CAMERA_KEY[c])} />
        <input type="range" aria-label={t(lang, "whatIf")} className="min-w-40 flex-1 accent-amber-400" min={0} max={timing.length - 1} step={0.1} value={shown}
          onChange={(e) => { f.current = Number(e.target.value); setShown(f.current) }} />
        <span className="tabular-nums text-sm text-slate-400">{sinceS >= 0 ? "+" : "−"}{Math.abs(sinceS).toFixed(1)} s</span>
      </div>
      <div className="relative aspect-[16/9] w-full">
        <Stage3D match={match} plays={plays} mode="split" layout="single" camera={camera} followed={clip.intervention.player_id} label={label} loading={t(lang, "loading3d")} failed={t(lang, "failed3d")} />
        {held && <span data-testid="paused" className="pointer-events-none absolute bottom-2 left-2 rounded bg-amber-400 px-2 py-0.5 text-sm font-semibold text-slate-950">{t(lang, "pausedHere")}</span>}
      </div>
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 rounded-lg bg-slate-900 px-4 py-2" data-testid="evidence-strip">
        <span className="font-semibold text-amber-300">{t(lang, VERDICT_KEY[clip.verdict])}</span>
        {clip.shots && (
          <>
            <span className="text-xl font-bold tabular-nums"><span className="text-emerald-400">{clip.shots.alt} / {n}</span> vs <span className="text-rose-400">{clip.shots.played} / {n}</span></span>
            <span className="text-sm">{t(lang, "shotsWithin")} {clip.horizon_s} s</span>
          </>
        )}
        {clip.goals && <span className="text-sm tabular-nums">{t(lang, "goals")}: {clip.goals.alt} vs {clip.goals.played}</span>}
        {clip.gain && <span className="text-sm tabular-nums">{t(lang, "gain")}: {clip.gain.mean >= 0 ? "+" : "−"}{Math.abs(clip.gain.mean).toFixed(2)} ± {clip.gain.se.toFixed(2)}</span>}
        {clip.typical_seed !== null && <span className="text-xs text-slate-400">{t(lang, "typical").replace("{k}", String(clip.typical_seed))}</span>}
      </div>
    </section>
  )
}
