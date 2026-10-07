import { useState } from "react"
import type { RecapView } from "@touchline/rpc"
import type { Segment } from "@touchline/schema"
import type { TouchlineClient } from "./client.js"
import { t, type Lang } from "./i18n.js"

/** The half-time and full-time recaps (Recap Producer), for the viewer's segment. */
export const RecapPanel = ({ client, matchId, segment, lang }: { client: TouchlineClient; matchId: string; segment: Segment; lang: Lang }) => {
  const [view, setView] = useState<{ kind: "half_time" | "full_time"; recap: RecapView } | null>(null)
  const open = (kind: "half_time" | "full_time") => client.recap(matchId, kind, segment).then((recap) => setView({ kind, recap }))
  return (
    <section className="rounded-lg bg-slate-900 p-3 ring-1 ring-slate-800">
      <div className="flex items-center gap-2">
        <h3 className="font-semibold">{t(lang, "recap")}</h3>
        <button type="button" className="rounded bg-slate-800 px-2 py-0.5 text-sm" onClick={() => open("half_time")}>{t(lang, "halfTime")}</button>
        <button type="button" className="rounded bg-slate-800 px-2 py-0.5 text-sm" onClick={() => open("full_time")}>{t(lang, "fullTime")}</button>
      </div>
      {view && (
        <div className="mt-2 text-sm">
          {view.recap.cards[0]?.text && (
            <p lang={view.recap.cards[0].segment.lang} className="font-semibold">{view.recap.cards[0].text.headline} — {view.recap.cards[0].text.body}</p>
          )}
          {view.recap.recap ? <ul className="mt-1 list-disc pl-5 text-slate-300">{view.recap.recap.sentences.map((s, i) => <li key={i}>{s}</li>)}</ul> : <p className="text-slate-400">—</p>}
        </div>
      )}
    </section>
  )
}
