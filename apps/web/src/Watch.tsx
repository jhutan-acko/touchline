import { useEffect, useState } from "react"
import type { MatchInfo, Playback } from "@touchline/rpc"
import type { Cue } from "@touchline/schema"
import type { TouchlineClient } from "./client.js"
import { t, type Lang } from "./i18n.js"
import { Live3D } from "./Live3D.js"
import { Overlays, useNow } from "./Overlays.js"
import { Pitch } from "./Pitch.js"
import { ProfileBar } from "./ProfileBar.js"
import { RecapPanel } from "./RecapPanel.js"
import { WhatIfSplit } from "./WhatIfSplit.js"
import { WhyDrawer } from "./WhyDrawer.js"
import { segmentOf, type Profile } from "./profile.js"
import { TopBar } from "./TopBar.js"
import { routeHash } from "./route.js"
import { usePane } from "./usePane.js"
import { hasWebGL } from "./view3d/webgl.js"

export const SPEEDS = [1, 2, 4, 8, 16, 32]

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
export const Pane = ({ client, sessionId, match, profile, onProfile, onWhy, label, view = "2d", onBetterPass }: {
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
}) => {
  const lang = profile.lang
  const pane = usePane(client, sessionId, segmentOf(profile))
  const now = useNow()
  const newest = pane.feed[0]
  useEffect(() => {
    if (newest?.display.template === "better_pass" && newest.evidence[0]) onBetterPass?.(newest.evidence[0])
  }, [newest?.cue_id])
  return (
    <section className="flex flex-col gap-2" aria-label={label}>
      <ProfileBar match={match} profile={profile} onChange={onProfile} {...(label ? { label } : {})} />
      <TopBar match={match} board={pane.board} lang={lang} />
      {view === "3d" ? (
        <Live3D match={match} frame={pane.frame} lang={lang}>
          <Overlays state={pane} now={now} lang={lang} {...(onWhy ? { onWhy } : {})} />
        </Live3D>
      ) : (
        <div className="relative">
          <Pitch frame={pane.frame} kits={{ home: match.home.kit.primary, away: match.away.kit.primary }} label={`${match.home.name} – ${match.away.name}`} />
          <Overlays state={pane} now={now} lang={lang} {...(onWhy ? { onWhy } : {})} />
        </div>
      )}
      {pane.connection !== "ok" && <p role="status" className="rounded bg-amber-900/60 px-3 py-1 text-center text-sm">{t(lang, pane.connection === "gone" ? "gone" : "lost")}</p>}
      {pane.playback?.state === "ended" && <p className="text-center font-semibold">{t(lang, "ended")}</p>}
      {pane.feed.length > 0 && (
        <ol aria-label="feed" className="flex max-h-40 flex-col gap-1 overflow-y-auto text-sm">
          {pane.feed.map((c) => (
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

/** Watching a session: the pane and the playback controls (shared by everyone watching it). */
export const Watch = ({ client, sessionId, match, profile, onProfile, onBack }: {
  client: TouchlineClient
  sessionId: string
  match: MatchInfo
  profile: Profile
  onProfile: (p: Profile) => void
  onBack: () => void
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
  const toggleView = () => {
    const v = view === "3d" ? "2d" : "3d"
    setView(v)
    saveView(v)
  }
  const [playback, setPlayback] = useState<Pick<Playback, "state" | "speed">>({ state: "playing", speed: 4 })
  const control = (action: "play" | "pause" | "speed", speed?: number) => client.control(sessionId, action, speed).then(setPlayback, () => {}) // a lost session shows on the pane
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="rounded bg-slate-800 px-3 py-1" onClick={onBack}>← {t(lang, "back")}</button>
        <button type="button" className="rounded bg-emerald-600 px-3 py-1 text-white" onClick={() => control(playback.state === "paused" ? "play" : "pause")}>
          {playback.state === "paused" ? t(lang, "play") : t(lang, "pause")}
        </button>
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
      {whatIf && <WhatIfSplit client={client} sessionId={sessionId} eventId={whatIf} match={match} lang={lang} onClose={() => setWhatIf(null)} />}
      <div className={`${second ? "grid gap-4 lg:grid-cols-2" : ""} ${whatIf ? "hidden" : ""}`}>
        <Pane client={client} sessionId={sessionId} match={match} profile={profile} onProfile={onProfile} onWhy={setWhy} label={second ? "A" : undefined} view={view} onBetterPass={(id) => autoWhatIf && !whatIf && setWhatIf(id)} />
        {second && <Pane client={client} sessionId={sessionId} match={match} profile={second} onProfile={setSecond} onWhy={setWhy} label="B" view={view} />}
      </div>
      <RecapPanel client={client} sessionId={sessionId} segment={segmentOf(profile)} lang={lang} />
      {why && <WhyDrawer client={client} sessionId={sessionId} cue={why} lang={lang} onClose={() => setWhy(null)} onShowMe={(id) => (setWhy(null), setWhatIf(id))} />}
    </div>
  )
}
