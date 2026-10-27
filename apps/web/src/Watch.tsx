import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { decisionKey, type MatchInfo, type Playback } from "@touchline/rpc"
import type { Cue, Decision } from "@touchline/schema"
import { AskPanel, markerQuestion } from "./AskPanel.js"
import { AskSplit } from "./AskSplit.js"
import type { TouchlineClient } from "./client.js"
import { t, type Lang } from "./i18n.js"
import { Live3D } from "./Live3D.js"
import { Overlays } from "./Overlays.js"
import type { Marker } from "./markers.js"
import { feedAt, frameAt, inSlot } from "./pane.js"
import { Pitch } from "./Pitch.js"
import { ProfileBar } from "./ProfileBar.js"
import { RecapPanel } from "./RecapPanel.js"
import { WhatIfSplit } from "./WhatIfSplit.js"
import { WhyDrawer } from "./WhyDrawer.js"
import { segmentOf, type Profile } from "./profile.js"
import { TopBar } from "./TopBar.js"
import { routeHash } from "./route.js"
import { usePane } from "./usePane.js"
import { DecisionCard, DecisionStrip } from "./Decisions.js"
import { playerStats } from "./follow.js"
import { PlayerCard } from "./PlayerCard.js"
import { hasWebGL } from "./view3d/webgl.js"

export const SPEEDS = [1, 2, 4, 8, 16, 32]

/** How long a decision card stays open on its own when its cue arrives. */
export const DECISION_CARD_MS = 12_000

/** The viewer's 2D or 3D choice, remembered in this browser (spec Plan 7: per viewer). */
export const VIEW_KEY = "touchline.view"
const savedView = (): "2d" | "3d" => {
  try {
    return localStorage.getItem(VIEW_KEY) === "3d" && hasWebGL() ? "3d" : "2d"
  } catch {
    return "2d"
  }
}
const saveView = (v: "2d" | "3d") => {
  try {
    localStorage.setItem(VIEW_KEY, v)
  } catch {
    // private window or blocked storage: the choice lasts this visit only
  }
}

/** One profile's view of a session: its profile bar, scoreboard, pitch and the cues for its segment over the pitch. */
export const Pane = ({ client, sessionId, match, profile, onProfile, onWhy, label, view = "2d", onBetterPass, onDecision, frozen = null, onHead, markers = [], onMarkerTap, ask, onFreezeAt }: {
  client: TouchlineClient
  sessionId: string
  match: MatchInfo
  profile: Profile
  onProfile: (p: Profile) => void
  onWhy?: (cue: Cue) => void
  label?: string
  view?: "2d" | "3d"
  /** Called with the pass when a better-pass cue arrives (the demo's auto-show). */
  onBetterPass?: (eventId: string) => void
  /** Called with the decision's key when a manager's decision cue arrives. */
  onDecision?: (key: string) => void
  /** The match frame this viewer froze on, or null when following live. */
  frozen?: number | null
  /** Told the latest match frame this pane knows of, as it moves (so the viewer can freeze on it). */
  onHead?: (frame: number | null) => void
  /** Pitch markers to draw besides the session's own (the 3D view only). */
  markers?: ReadonlyArray<Cue>
  onMarkerTap?: (m: Marker, cue: Cue) => void
  /** The Ask panel: over the picture on the right in 3D, under it in 2D. */
  ask?: ReactNode
  /** Freeze this viewer on a match frame (a moment tapped on the player card). */
  onFreezeAt?: (frame: number) => void
}) => {
  const lang = profile.lang
  const pane = usePane(client, sessionId, segmentOf(profile), match.fps)
  useEffect(() => void onHead?.(pane.head), [pane.head])
  // Frozen: the frame frozen on, taken from the ring once (ticks keep arriving underneath); overlays at that frame.
  const still = useMemo(() => (frozen === null ? null : frameAt(pane, frozen)), [frozen])
  const shown = frozen === null ? pane.frame : still
  const at = frozen ?? pane.head ?? 0
  const pitchMarkers = [...inSlot(pane, "pitch_marker", at, frozen), ...markers]
  // Frozen, nothing that arrived since shows: the scoreboard as it was, the feed as it stood, and no pop-ups.
  const frozenBoard = useMemo(() => (frozen === null ? null : pane.board), [frozen])
  const board = frozen === null ? pane.board : frozenBoard
  const feed = frozen === null ? pane.feed : feedAt(pane, frozen)
  const newest = pane.feed[0]
  // Follow my player: the favourite's card, as of the frame shown (frozen: as of the frozen frame, taken once).
  const fav = useMemo(() => match.players.find((p) => p.id === profile.player) ?? null, [match, profile.player])
  const liveStats = fav && frozen === null ? playerStats(pane.follow, fav.id, at, match.fps) : null
  const frozenStats = useMemo(() => (fav && frozen !== null ? playerStats(pane.follow, fav.id, frozen, match.fps) : null), [frozen, fav])
  const stats = frozen === null ? liveStats : frozenStats
  const focus = useMemo(() => (fav ? { id: fav.id, label: `#${fav.jersey} ${fav.name}` } : null), [fav])
  const card = (where: string) =>
    fav && stats && (
      <PlayerCard player={fav} team={fav.team_id === match.home.id ? match.home : match.away} stats={stats} mode={profile.mode} lang={lang} className={`absolute z-10 ${where}`}
        canShow={(f) => frameAt(pane, f) !== null && f <= (pane.head ?? 0)} {...(onFreezeAt ? { onMoment: onFreezeAt } : {})} />
    )
  useEffect(() => {
    if (frozen !== null) return
    if (newest?.display.template === "better_pass" && newest.evidence[0]) onBetterPass?.(newest.evidence[0])
    if (newest?.display.template === "manager_decision" && newest.evidence[0]) onDecision?.(newest.evidence[0])
  }, [newest?.cue_id])
  return (
    <section className="flex flex-col gap-2" aria-label={label}>
      <ProfileBar match={match} profile={profile} onChange={onProfile} {...(label ? { label } : {})} />
      <TopBar match={match} board={board} lang={lang} />
      {view === "3d" ? (
        <Live3D match={match} frame={shown} playback={pane.playback} lang={lang} frozen={frozen} markers={pitchMarkers} favourite={fav?.id ?? null} {...(onMarkerTap ? { onMarkerTap } : {})}>
          <Overlays state={pane} frame={at} frozen={frozen} lang={lang} {...(onWhy ? { onWhy } : {})} />
          {card("left-2 top-10")}
          {ask && <div className="pointer-events-none absolute inset-y-2 right-2 z-10 flex w-[min(22rem,calc(100%-1rem))] flex-col">{ask}</div>}
        </Live3D>
      ) : (
        <div className="relative">
          <Pitch frame={shown} kits={{ home: match.home.kit.primary, away: match.away.kit.primary }} label={`${match.home.name} – ${match.away.name}`} focus={focus} />
          <Overlays state={pane} frame={at} frozen={frozen} lang={lang} {...(onWhy ? { onWhy } : {})} />
          {card("left-3 top-3")}
        </div>
      )}
      {view !== "3d" && ask}
      {pane.connection !== "ok" && <p role="status" className="rounded bg-amber-900/60 px-3 py-1 text-center text-sm">{t(lang, pane.connection === "gone" ? "gone" : "lost")}</p>}
      {pane.playback?.state === "ended" && <p className="text-center font-semibold">{t(lang, "ended")}</p>}
      {feed.length > 0 && (
        <ol aria-label="feed" className="flex max-h-40 flex-col gap-1 overflow-y-auto text-sm">
          {feed.map((c) => (
            <li key={c.cue_id} lang={c.segment.lang} className="flex items-center gap-2 rounded bg-slate-900 px-2 py-1">
              <span className="tabular-nums text-slate-400">{c.anchor.clock}</span>
              <span className="truncate">{c.text?.headline}</span>
              {onWhy && <button type="button" className="ml-auto rounded bg-slate-800 px-2 text-xs" onClick={() => onWhy(c)}>{t(lang, "why")}</button>}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

/** The frame named by a `freezeAt` query parameter, or null. */
const freezeAtParam = (search: string): number | null => {
  const raw = new URLSearchParams(search).get("freezeAt")
  const v = raw ? Number(raw) : NaN
  return Number.isInteger(v) && v >= 0 ? v : null
}

/**
 * Watching a session: the pane and the controls. Pause (or the space bar) freezes this viewer's picture on the latest
 * frame while the match plays on underneath and opens the Ask panel for that frame (tapping a pitch marker does too,
 * with its question filled in); its Show me replaces the panes with the spoiler-free split. Resuming closes both and
 * jumps back to live. Speed is the session's, shared by everyone watching it (the session's own pause is in Studio).
 */
export const Watch = ({ client, sessionId, match, profile, onProfile, onBack, onFreeze, onResume, onMarkerTap }: {
  client: TouchlineClient
  sessionId: string
  match: MatchInfo
  profile: Profile
  onProfile: (p: Profile) => void
  onBack: () => void
  /** Called with the frame when this viewer freezes. */
  onFreeze?: (frame: number) => void
  /** Called when this viewer goes back to live. */
  onResume?: () => void
  /** A pitch marker tapped in the 3D view. */
  onMarkerTap?: (m: Marker, cue: Cue) => void
}) => {
  const lang: Lang = profile.lang
  const [why, setWhy] = useState<Cue | null>(null)
  // The what-if split on a pass: only this viewer leaves the live match (the panes keep receiving it, hidden).
  const [whatIf, setWhatIf] = useState<string | null>(null)
  const [autoWhatIf, setAutoWhatIf] = useState(false)
  // Demo mode (spec §5.6): a second profile on the same session, side by side; by default the other mode, in Spanish.
  const [second, setSecond] = useState<Profile | null>(null)
  const toggleSplit = () => setSecond(second ? null : { mode: profile.mode === "casual" ? "analyst" : "casual", lang: profile.lang === "es" ? "hi" : "es", clubs: [], player: profile.player })
  const [view, setView] = useState<"2d" | "3d">(savedView)
  const webgl = hasWebGL()
  const toggleView = () => {
    const v = view === "3d" ? "2d" : "3d"
    setView(v)
    saveView(v)
  }
  // Manager decisions (Plan 4b): the strip of decisions reached so far, and the cards of one moment open (on a cue, or
  // from the strip): both teams' when both decided then.
  const [decisions, setDecisions] = useState<ReadonlyArray<Decision>>([])
  const [decision, setDecision] = useState<{ tick: number; auto: boolean } | null>(null)
  const showDecision = (key: string, auto: boolean) =>
    client.decisions(sessionId).then((ds) => {
      setDecisions(ds)
      const d = ds.find((x) => decisionKey(x) === key)
      if (d) setDecision({ tick: d.tick, auto })
    }, () => {}) // a lost session shows on the pane
  // A managed match watched from a later minute: the decisions already reached go on the strip at once.
  useEffect(() => {
    if (match.managers) client.decisions(sessionId).then(setDecisions, () => {})
  }, [sessionId])
  useEffect(() => {
    if (!decision?.auto) return
    const timer = setTimeout(() => setDecision(null), DECISION_CARD_MS)
    return () => clearTimeout(timer)
  }, [decision])
  const onWhyCue = (c: Cue) => (c.display.template === "manager_decision" && c.evidence[0] ? void showDecision(c.evidence[0], false) : setWhy(c))
  const [playback, setPlayback] = useState<Pick<Playback, "state" | "speed">>({ state: "playing", speed: 4 })
  const control = (action: "speed", speed: number) => client.control(sessionId, action, speed).then(setPlayback, () => {}) // a lost session shows on the pane
  // This viewer's freeze: the match frame frozen on (the first pane's latest), or null when live.
  const [frozen, setFrozen] = useState<number | null>(null)
  const head = useRef<number | null>(null)
  // Pause and ask: the panel (open on a freeze until closed), the question a tapped marker filled in, and Show me's clip.
  const [askOpen, setAskOpen] = useState(false)
  const [prefill, setPrefill] = useState<string | undefined>(undefined)
  const [askClip, setAskClip] = useState<string | null>(null)
  const freeze = (at?: number) => {
    const f = at ?? head.current ?? 0
    setFrozen(f)
    setAskOpen(true)
    onFreeze?.(f)
  }
  // Recording a demo: ?freezeAt=<frame> freezes on exactly that frame (one a cached answer was built for) once it arrives.
  const freezeAt = useRef(freezeAtParam(window.location.search))
  const onHead = (f: number | null) => {
    head.current = f
    const at = freezeAt.current
    if (at !== null && f !== null && f >= at) {
      freezeAt.current = null
      freeze(at)
    }
  }
  const toggleFreeze = () => {
    if (frozen === null) freeze()
    else {
      setFrozen(null)
      setAskOpen(false)
      setPrefill(undefined)
      setAskClip(null)
      onResume?.()
    }
  }
  const names = useMemo(() => Object.fromEntries(match.players.map((p) => [p.id, `#${p.jersey} ${p.name}`])), [match])
  const tapMarker = (m: Marker, c: Cue) => {
    if (frozen === null) freeze()
    setPrefill(markerQuestion(m, names, lang))
    setAskOpen(true)
    onMarkerTap?.(m, c)
  }
  // A question about the favourite player, offered alongside the suggested ones.
  const favName = match.players.find((p) => p.id === profile.player)?.name
  const ask = frozen !== null && askOpen
    ? <AskPanel client={client} sessionId={sessionId} frame={frozen} segment={segmentOf(profile)} {...(prefill !== undefined ? { prefill } : {})} extra={favName ? [t(lang, "askPlayer").replace("{name}", favName)] : []} onShowMe={setAskClip} onClose={() => setAskOpen(false)} />
    : null
  const toggle = useRef(toggleFreeze)
  toggle.current = toggleFreeze
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== " " || e.repeat) return
      const el = e.target
      // Typing, or a focused control the space bar presses itself.
      if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement || el instanceof HTMLButtonElement || (el instanceof HTMLElement && el.isContentEditable)) return
      e.preventDefault()
      toggle.current()
    }
    window.addEventListener("keydown", key)
    return () => window.removeEventListener("keydown", key)
  }, [])
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="rounded bg-slate-800 px-3 py-1" onClick={onBack}>← {t(lang, "back")}</button>
        <button type="button" className="rounded bg-emerald-600 px-3 py-1 text-white" aria-pressed={frozen !== null} onClick={toggleFreeze}>
          {frozen !== null ? t(lang, "play") : t(lang, "pause")}
        </button>
        {frozen !== null && !askOpen && <button type="button" className="rounded bg-amber-400 px-3 py-1 font-semibold text-slate-950" onClick={() => setAskOpen(true)}>{t(lang, "askReopen")}</button>}
        <button type="button" className="rounded bg-slate-800 px-3 py-1" onClick={toggleSplit}>{second ? t(lang, "single") : t(lang, "split")}</button>
        <button type="button" className="rounded bg-slate-800 px-3 py-1 disabled:opacity-50" onClick={toggleView} disabled={!webgl} title={webgl ? undefined : t(lang, "noWebgl")}>
          {view === "3d" ? t(lang, "view2d") : t(lang, "view3d")}
        </button>
        <a className="rounded bg-slate-800 px-3 py-1" target="_blank" rel="noreferrer" href={routeHash({ page: "studio", session: sessionId, segment: segmentOf(profile) })}>{t(lang, "studio")}</a>
        <a className="rounded bg-slate-800 px-3 py-1" target="_blank" rel="noreferrer" href={routeHash({ page: "graphics", session: sessionId, segment: segmentOf(profile), match: match.match_id })}>{t(lang, "graphicsOut")}</a>
        <a className="rounded bg-slate-800 px-3 py-1" target="_blank" rel="noreferrer" href={routeHash({ page: "ops", session: sessionId, lang })}>{t(lang, "opsView")}</a>
        <label className="text-sm">
          <input type="checkbox" className="mr-1" checked={autoWhatIf} onChange={(e) => setAutoWhatIf(e.target.checked)} />
          {t(lang, "autoWhatIf")}
        </label>
        <label className="text-sm">
          {t(lang, "speed")}{" "}
          <select aria-label={t(lang, "speed")} className="rounded bg-slate-800 px-2 py-1" value={playback.speed} onChange={(e) => control("speed", Number(e.target.value))}>
            {SPEEDS.map((s) => <option key={s} value={s}>×{s}</option>)}
          </select>
        </label>
      </div>
      {(match.managers || decisions.length > 0) && <DecisionStrip match={match} decisions={decisions} open={decision?.tick ?? null} onOpen={(tick) => setDecision({ tick, auto: false })} lang={lang} />}
      {decision && (
        <div className="grid gap-2 lg:grid-cols-2">
          {decisions.filter((d) => d.tick === decision.tick).map((d) => <DecisionCard key={decisionKey(d)} match={match} decision={d} all={decisions} onClose={() => setDecision(null)} lang={lang} />)}
        </div>
      )}
      {whatIf && <WhatIfSplit client={client} sessionId={sessionId} eventId={whatIf} match={match} lang={lang} onClose={() => setWhatIf(null)} />}
      {askClip && !whatIf && <AskSplit client={client} sessionId={sessionId} clipId={askClip} match={match} lang={lang} onClose={() => setAskClip(null)} />}
      <div className={`${second ? "grid gap-4 lg:grid-cols-2" : ""} ${whatIf || askClip ? "hidden" : ""}`}>
        <Pane client={client} sessionId={sessionId} match={match} profile={profile} onProfile={onProfile} onWhy={onWhyCue} label={second ? "A" : undefined} view={view} frozen={frozen} onHead={onHead} onMarkerTap={tapMarker} ask={ask} onFreezeAt={freeze} onBetterPass={(id) => autoWhatIf && !whatIf && setWhatIf(id)} onDecision={(key) => void showDecision(key, true)} />
        {second && <Pane client={client} sessionId={sessionId} match={match} profile={second} onProfile={setSecond} onWhy={onWhyCue} label="B" view={view} frozen={frozen} onMarkerTap={tapMarker} />}
      </div>
      <RecapPanel client={client} sessionId={sessionId} segment={segmentOf(profile)} lang={lang} />
      {why && <WhyDrawer client={client} sessionId={sessionId} cue={why} lang={lang} onClose={() => setWhy(null)} onShowMe={(id) => (setWhy(null), setWhatIf(id))} />}
    </div>
  )
}
