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
import { PulseStrip } from "./PulseStrip.js"
import { ProfileBar } from "./ProfileBar.js"
import { RecapPanel } from "./RecapPanel.js"
import { WhatIfSplit } from "./WhatIfSplit.js"
import { WhyDrawer } from "./WhyDrawer.js"
import { segmentOf, type Profile } from "./profile.js"
import { TopBar } from "./TopBar.js"
import { routeHash } from "./route.js"
import { usePane } from "./usePane.js"
import { DecisionCard, DecisionStrip } from "./Decisions.js"
import { hasWebGL } from "./view3d/webgl.js"
import { ASK_DRAWER_ATTR, spaceToggles } from "./keys.js"
import { BroadcastMenu, FanBar, PauseHint } from "./WatchBar.js"
import type { PaneState } from "./pane.js"

export const SPEEDS = [1, 2, 4, 8, 16, 32]

/** How long a decision card stays open on its own when its cue arrives. */
export const DECISION_CARD_MS = 12_000

/**
 * The viewer's 2D or 3D choice, remembered in this browser (spec Plan 7: per viewer). With no choice saved, 3D when
 * this browser can draw it; a saved choice always wins (but 3D needs WebGL).
 */
export const VIEW_KEY = "touchline.view"
export const initialView = (saved: string | null, webgl: boolean): "2d" | "3d" => (saved === "2d" || !webgl ? "2d" : "3d")
const savedView = (): "2d" | "3d" => {
  let saved: string | null = null
  try {
    saved = localStorage.getItem(VIEW_KEY)
  } catch {
    // blocked storage: as if nothing were saved
  }
  return initialView(saved, hasWebGL())
}
const saveView = (v: "2d" | "3d") => {
  try {
    localStorage.setItem(VIEW_KEY, v)
  } catch {
    // private window or blocked storage: the choice lasts this visit only
  }
}

/**
 * What a pane shows at this moment, for components mounted on or under its stage (a player card, stat tags, a pulse
 * strip): its state, the frame on screen, the match frame it is at, and the frozen frame (null when live). Nothing in
 * `pane` that arrived after `frozen` may be shown (see pane.ts: `arrivedAt`, `feedAt`).
 */
export interface StageView {
  readonly pane: PaneState
  readonly shown: PaneState["frame"]
  readonly at: number
  readonly frozen: number | null
  readonly match: MatchInfo
  readonly lang: Lang
  readonly view: "2d" | "3d"
}

/** How wide the stage may get so all of it fits on screen under the controls (2D pitch 105:68, 3D 16:9 plus its toolbar). */
const STAGE_MAX_W = { "2d": "max(24rem, calc((100svh - 13rem) * 105 / 68))", "3d": "max(24rem, calc((100svh - 17rem) * 16 / 9))" } as const

/**
 * One profile's view of a session: its scoreboard, the stage (the 2D pitch or the 3D view) with the cue overlays on it,
 * and the feed. The stage is a positioned box with an overlay layer (`overlay`, drawn over the picture: put
 * `pointer-events-auto` on anything clickable) and a slot right under it (`under`). The profile bar is shown here only
 * when asked (`showProfile`): the first pane's sits in the fan bar.
 */
export const Pane = ({ client, sessionId, match, profile, onProfile, onWhy, label, view = "2d", onBetterPass, onDecision, frozen = null, onHead, markers = [], onMarkerTap, showProfile = false, overlay, under, hint, onPulseFreeze }: {
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
  /** Show this pane's own profile bar (the second pane of the split screen). */
  showProfile?: boolean
  /** Drawn over the stage, in its overlay layer. */
  overlay?: (s: StageView) => ReactNode
  /** Right under the stage. */
  under?: (s: StageView) => ReactNode
  /** A pulse-strip moment still in the ring buffer was clicked: freeze there and open Ask. */
  onPulseFreeze?: (frame: number) => void
  /** Shown over the top of the stage (the first-visit hint). */
  hint?: ReactNode
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
  const numbers = useMemo(() => new Map(match.players.map((p) => [p.id, p.jersey])), [match])
  const kits = useMemo(() => ({ home: match.home.kit.primary, away: match.away.kit.primary }), [match])
  const stage: StageView = { pane, shown, at, frozen, match, lang, view }
  const layer = (
    <>
      <Overlays state={pane} frame={at} frozen={frozen} lang={lang} {...(onWhy ? { onWhy } : {})} />
      <div data-testid="stage-overlay" className="pointer-events-none absolute inset-0 z-10">{overlay?.(stage)}</div>
      {hint}
    </>
  )
  const newest = pane.feed[0]
  useEffect(() => {
    if (frozen !== null) return
    if (newest?.display.template === "better_pass" && newest.evidence[0]) onBetterPass?.(newest.evidence[0])
    if (newest?.display.template === "manager_decision" && newest.evidence[0]) onDecision?.(newest.evidence[0])
  }, [newest?.cue_id])
  return (
    <section className="flex min-w-0 flex-col gap-2" aria-label={label}>
      {showProfile && <ProfileBar match={match} profile={profile} onChange={onProfile} {...(label ? { label } : {})} />}
      <TopBar match={match} board={board} lang={lang} />
      <div data-testid="stage-box" className="mx-auto flex w-full flex-col gap-2" style={{ maxWidth: STAGE_MAX_W[view] }}>
        {view === "3d" ? (
          <Live3D match={match} frame={shown} playback={pane.playback} lang={lang} frozen={frozen} markers={pitchMarkers} {...(onMarkerTap ? { onMarkerTap } : {})}>
            {layer}
          </Live3D>
        ) : (
          <div className="relative overflow-hidden rounded-lg">
            <Pitch frame={shown} kits={kits} numbers={numbers} label={`${match.home.name} – ${match.away.name}`} />
            {layer}
          </div>
        )}
        <PulseStrip state={pane} match={match} mode={profile.mode} lang={lang} frozen={frozen} {...(onPulseFreeze ? { onFreeze: onPulseFreeze } : {})} {...(onWhy ? { onWhy } : {})} />
        {under && <div data-testid="under-stage">{under(stage)}</div>}
      </div>
      {pane.connection !== "ok" && <p role="status" className="rounded bg-amber-900/60 px-3 py-1 text-center text-sm">{t(lang, pane.connection === "gone" ? "gone" : "lost")}</p>}
      {pane.playback?.state === "ended" && <p className="text-center font-semibold">{t(lang, "ended")}</p>}
      {feed.length > 0 && (
        <ol aria-label="feed" className="flex max-h-40 flex-col gap-1 overflow-y-auto text-sm">
          {feed.map((c) => (
            <li key={c.cue_id} lang={c.segment.lang} className="flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-1.5">
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
export const Watch = ({ client, sessionId, match, profile, onProfile, onBack, onFreeze, onResume, onMarkerTap, overlay, under }: {
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
  /** Mounted over the first pane's stage (see Pane). */
  overlay?: (s: StageView) => ReactNode
  /** Mounted right under the first pane's stage (see Pane). */
  under?: (s: StageView) => ReactNode
}) => {
  const lang: Lang = profile.lang
  const [why, setWhy] = useState<Cue | null>(null)
  // The what-if split on a pass: only this viewer leaves the live match (the panes keep receiving it, hidden).
  const [whatIf, setWhatIf] = useState<string | null>(null)
  const [autoWhatIf, setAutoWhatIf] = useState(false)
  // Demo mode (spec §5.6): a second profile on the same session, side by side; by default the other mode, in Spanish.
  const [second, setSecond] = useState<Profile | null>(null)
  const toggleSplit = () => setSecond(second ? null : { mode: profile.mode === "casual" ? "analyst" : "casual", lang: profile.lang === "es" ? "hi" : "es", clubs: [] })
  const [view, setView] = useState<"2d" | "3d">(savedView)
  const webgl = hasWebGL()
  const chooseView = (v: "2d" | "3d") => {
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
  const ask = frozen !== null && askOpen
    ? <AskPanel client={client} sessionId={sessionId} frame={frozen} segment={segmentOf(profile)} {...(prefill !== undefined ? { prefill } : {})} onShowMe={setAskClip} onClose={() => setAskOpen(false)} />
    : null
  const toggle = useRef(toggleFreeze)
  toggle.current = toggleFreeze
  useEffect(() => {
    // Space toggles the freeze whatever has focus (see keys.ts); its default (clicking a focused button, scrolling) is
    // stopped on the way down and on the way up, as browsers click a button on keyup.
    const first = (e: KeyboardEvent) => ({ key: e.key, repeat: false, target: e.target, altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey })
    const down = (e: KeyboardEvent) => {
      if (!spaceToggles(first(e))) return
      e.preventDefault()
      if (!e.repeat) toggle.current() // a held space bar toggles once
    }
    const up = (e: KeyboardEvent) => {
      if (spaceToggles(first(e))) e.preventDefault()
    }
    window.addEventListener("keydown", down)
    window.addEventListener("keyup", up)
    return () => {
      window.removeEventListener("keydown", down)
      window.removeEventListener("keyup", up)
    }
  }, [])
  const segment = segmentOf(profile)
  const tools = (
    <BroadcastMenu
      lang={lang}
      links={[
        { label: t(lang, "studio"), href: routeHash({ page: "studio", session: sessionId, segment }) },
        { label: t(lang, "graphicsOut"), href: routeHash({ page: "graphics", session: sessionId, segment, match: match.match_id }) },
        { label: t(lang, "opsView"), href: routeHash({ page: "ops", session: sessionId, lang }) }
      ]}
      split={second !== null}
      onSplit={toggleSplit}
      autoWhatIf={autoWhatIf}
      onAutoWhatIf={setAutoWhatIf}
    />
  )
  return (
    <div className="flex flex-col gap-3">
      <FanBar
        lang={lang}
        onBack={onBack}
        frozen={frozen !== null}
        onToggleFreeze={toggleFreeze}
        onAsk={frozen !== null && !askOpen ? () => setAskOpen(true) : undefined}
        speeds={SPEEDS}
        speed={playback.speed}
        onSpeed={(v) => void control("speed", v)}
        view={view}
        webgl={webgl}
        onView={chooseView}
        profile={second ? null : <ProfileBar match={match} profile={profile} onChange={onProfile} />}
        tools={tools}
      />
      {(match.managers || decisions.length > 0) && <DecisionStrip match={match} decisions={decisions} open={decision?.tick ?? null} onOpen={(tick) => setDecision({ tick, auto: false })} lang={lang} />}
      {decision && (
        <div className="grid gap-2 lg:grid-cols-2">
          {decisions.filter((d) => d.tick === decision.tick).map((d) => <DecisionCard key={decisionKey(d)} match={match} decision={d} all={decisions} onClose={() => setDecision(null)} lang={lang} />)}
        </div>
      )}
      {whatIf && <WhatIfSplit client={client} sessionId={sessionId} eventId={whatIf} match={match} lang={lang} onClose={() => setWhatIf(null)} />}
      {askClip && !whatIf && <AskSplit client={client} sessionId={sessionId} clipId={askClip} match={match} lang={lang} onClose={() => setAskClip(null)} />}
      {/* The panes, and the Ask drawer beside them (right on wide screens, a bottom sheet on phones). */}
      <div className={`flex flex-col gap-4 lg:flex-row lg:items-start ${whatIf || askClip ? "hidden" : ""}`}>
        <div className={`min-w-0 flex-1 ${second ? "grid gap-4 xl:grid-cols-2" : ""}`}>
          <Pane client={client} sessionId={sessionId} match={match} profile={profile} onProfile={onProfile} onWhy={onWhyCue} label={second ? "A" : undefined} showProfile={second !== null} view={view} frozen={frozen} onHead={onHead} onMarkerTap={tapMarker} onPulseFreeze={freeze} onBetterPass={(id) => autoWhatIf && !whatIf && setWhatIf(id)} onDecision={(key) => void showDecision(key, true)} hint={<PauseHint lang={lang} frozen={frozen !== null} />} {...(overlay ? { overlay } : {})} {...(under ? { under } : {})} />
          {second && <Pane client={client} sessionId={sessionId} match={match} profile={second} onProfile={setSecond} onWhy={onWhyCue} label="B" showProfile view={view} frozen={frozen} onMarkerTap={tapMarker} onPulseFreeze={freeze} />}
        </div>
        {ask && (
          <aside {...{ [ASK_DRAWER_ATTR]: "" }} className="fixed inset-x-0 bottom-0 z-30 flex max-h-[60svh] flex-col p-2 lg:sticky lg:inset-x-auto lg:top-4 lg:z-auto lg:max-h-[calc(100svh-2rem)] lg:w-[22rem] lg:shrink-0 lg:p-0">
            {ask}
          </aside>
        )}
      </div>
      <RecapPanel client={client} sessionId={sessionId} segment={segmentOf(profile)} lang={lang} />
      {why && <WhyDrawer client={client} sessionId={sessionId} cue={why} lang={lang} onClose={() => setWhy(null)} onShowMe={(id) => (setWhy(null), setWhatIf(id))} />}
    </div>
  )
}
