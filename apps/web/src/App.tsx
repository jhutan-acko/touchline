import { useEffect, useState } from "react"
import type { MatchSummary } from "@touchline/rpc"
import type { TouchlineClient } from "./client.js"
import { LANG_NAMES, t, type Lang } from "./i18n.js"
import { MatchList } from "./MatchList.js"

/** The fan app: pick a match from the library, then watch it (Task 10 on). */
export const App = ({ client }: { client: TouchlineClient }) => {
  const [lang, setLang] = useState<Lang>("en")
  const [matches, setMatches] = useState<ReadonlyArray<MatchSummary> | null>(null)
  useEffect(() => {
    client.listMatches().then(setMatches, () => setMatches([]))
  }, [client])
  return (
    <main className="mx-auto max-w-6xl p-6 font-sans">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t(lang, "title")}</h1>
          <p className="text-slate-400">{t(lang, "tagline")}</p>
        </div>
        <label className="text-sm">
          <span className="sr-only">{t(lang, "language")}</span>
          <select aria-label={t(lang, "language")} className="rounded bg-slate-800 px-2 py-1" value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
            {(Object.keys(LANG_NAMES) as Lang[]).map((l) => <option key={l} value={l}>{LANG_NAMES[l]}</option>)}
          </select>
        </label>
      </header>
      <h2 className="mb-3 text-lg font-semibold">{t(lang, "matches")}</h2>
      {matches === null ? <p>{t(lang, "loading")}</p> : <MatchList matches={matches} lang={lang} onWatch={() => {}} />}
    </main>
  )
}
