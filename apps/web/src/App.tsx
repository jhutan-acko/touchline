import { useEffect, useState } from "react"
import type { MatchInfo, MatchSummary } from "@touchline/rpc"
import type { TouchlineClient } from "./client.js"
import { withTeamColours } from "./colours.js"
import { LANG_NAMES, t, type Lang } from "./i18n.js"
import { MatchList } from "./MatchList.js"
import type { Profile } from "./profile.js"
import { Watch } from "./Watch.js"

/** The fan app: pick a match from the library, then watch it. */
export const App = ({ client }: { client: TouchlineClient }) => {
  const [profile, setProfile] = useState<Profile>({ mode: "casual", lang: "en", clubs: [] })
  const lang = profile.lang
  const setLang = (l: Lang) => setProfile({ ...profile, lang: l })
  const [matches, setMatches] = useState<ReadonlyArray<MatchSummary> | null>(null)
  const [live, setLive] = useState(false)
  const [fromMinute, setFromMinute] = useState(0)
  const [session, setSession] = useState<{ id: string; match: MatchInfo } | null>(null)
  const [failed, setFailed] = useState(false)
  const watch = (m: MatchSummary) =>
    client.startSession(m.match_id, { speed: 4, fromMinute, live }).then(
      (s) => {
        setFailed(false)
        setSession({ id: s.session_id, match: withTeamColours(s.match) })
      },
      () => setFailed(true)
    )
  useEffect(() => {
    client.listMatches().then(setMatches, () => setMatches([]))
  }, [client])
  return (
    <main className="mx-auto max-w-7xl p-4 font-sans sm:p-6">
      <header className={`${session ? "mb-3" : "mb-6"} flex items-center justify-between gap-4`}>
        <div>
          <h1 className={`${session ? "text-xl" : "text-2xl"} font-bold`}>{t(lang, "title")}</h1>
          {!session && <p className="text-slate-400">{t(lang, "tagline")}</p>}
        </div>
        {!session && <label className="text-sm">
          <span className="sr-only">{t(lang, "language")}</span>
          <select aria-label={t(lang, "language")} className="rounded bg-slate-800 px-2 py-1" value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
            {(Object.keys(LANG_NAMES) as Lang[]).map((l) => <option key={l} value={l}>{LANG_NAMES[l]}</option>)}
          </select>
        </label>}
      </header>
      {failed && <p role="alert" className="mb-4 rounded bg-red-900/60 px-3 py-2">{t(lang, "startFailed")}</p>}
      {session ? (
        <Watch client={client} sessionId={session.id} match={session.match} profile={profile} onProfile={setProfile} onBack={() => setSession(null)} />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-4">
            <h2 className="text-lg font-semibold">{t(lang, "matches")}</h2>
            <label className="text-sm">
              <input type="checkbox" className="mr-1" checked={live} onChange={(e) => setLive(e.target.checked)} />
              {t(lang, "live")}
            </label>
            <label className="text-sm">
              {t(lang, "fromMinute")}{" "}
              <input type="number" min={0} max={90} aria-label={t(lang, "fromMinute")} className="w-16 rounded bg-slate-800 px-2 py-1" value={fromMinute} onChange={(e) => setFromMinute(Number(e.target.value))} />
            </label>
          </div>
          {matches === null ? <p>{t(lang, "loading")}</p> : <MatchList matches={matches} lang={lang} onWatch={watch} />}
        </>
      )}
    </main>
  )
}
