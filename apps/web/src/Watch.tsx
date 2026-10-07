import { useState } from "react"
import type { MatchInfo, Playback } from "@touchline/rpc"
import type { Cue } from "@touchline/schema"
import type { TouchlineClient } from "./client.js"
import { t, type Lang } from "./i18n.js"
import { Overlays, useNow } from "./Overlays.js"
import { Pitch } from "./Pitch.js"
import { ProfileBar } from "./ProfileBar.js"
import { RecapPanel } from "./RecapPanel.js"
import { WhyDrawer } from "./WhyDrawer.js"
import { segmentOf, type Profile } from "./profile.js"
import { TopBar } from "./TopBar.js"
import { routeHash } from "./route.js"
import { usePane } from "./usePane.js"

export const SPEEDS = [1, 2, 4, 8, 16, 32]

/** One profile's view of a session: its profile bar, scoreboard, pitch and the cues for its segment over the pitch. */
export const Pane = ({ client, sessionId, match, profile, onProfile, onWhy, label }: {
  client: TouchlineClient
  sessionId: string
  match: MatchInfo
  profile: Profile
  onProfile: (p: Profile) => void
  onWhy?: (cue: Cue) => void
  label?: string
}) => {
  const lang = profile.lang
  const pane = usePane(client, sessionId, segmentOf(profile))
  const now = useNow()
  return (
    <section className="flex flex-col gap-2" aria-label={label}>
      <ProfileBar match={match} profile={profile} onChange={onProfile} {...(label ? { label } : {})} />
      <TopBar match={match} board={pane.board} lang={lang} />
      <div className="relative">
        <Pitch frame={pane.frame} kits={{ home: match.home.kit.primary, away: match.away.kit.primary }} label={`${match.home.name} – ${match.away.name}`} />
        <Overlays state={pane} now={now} lang={lang} {...(onWhy ? { onWhy } : {})} />
      </div>
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
  // Demo mode (spec §5.6): a second profile on the same session, side by side; by default the other mode, in Spanish.
  const [second, setSecond] = useState<Profile | null>(null)
  const toggleSplit = () => setSecond(second ? null : { mode: profile.mode === "casual" ? "analyst" : "casual", lang: profile.lang === "es" ? "hi" : "es", clubs: [] })
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
        <a className="rounded bg-slate-800 px-3 py-1" target="_blank" rel="noreferrer" href={routeHash({ page: "studio", session: sessionId, segment: segmentOf(profile) })}>{t(lang, "studio")}</a>
        <a className="rounded bg-slate-800 px-3 py-1" target="_blank" rel="noreferrer" href={routeHash({ page: "graphics", session: sessionId, segment: segmentOf(profile), match: match.match_id })}>{t(lang, "graphicsOut")}</a>
        <label className="text-sm">
          {t(lang, "speed")}{" "}
          <select aria-label={t(lang, "speed")} className="rounded bg-slate-800 px-2 py-1" value={playback.speed} onChange={(e) => control("speed", Number(e.target.value))}>
            {SPEEDS.map((s) => <option key={s} value={s}>×{s}</option>)}
          </select>
        </label>
      </div>
      <div className={second ? "grid gap-4 lg:grid-cols-2" : ""}>
        <Pane client={client} sessionId={sessionId} match={match} profile={profile} onProfile={onProfile} onWhy={setWhy} label={second ? "A" : undefined} />
        {second && <Pane client={client} sessionId={sessionId} match={match} profile={second} onProfile={setSecond} onWhy={setWhy} label="B" />}
      </div>
      <RecapPanel client={client} sessionId={sessionId} segment={segmentOf(profile)} lang={lang} />
      {why && <WhyDrawer client={client} sessionId={sessionId} cue={why} lang={lang} onClose={() => setWhy(null)} />}
    </div>
  )
}
