import { useEffect, useState } from "react"
import type { Budget, OpsReport } from "@touchline/rpc"
import type { TouchlineClient } from "./client.js"
import { t, type Lang } from "./i18n.js"

/** How often the ops view asks for fresh numbers. */
export const OPS_POLL_MS = 2000

const Tile = ({ name, children }: { name: string; children: React.ReactNode }) => (
  <section aria-label={name} className="rounded-lg bg-slate-900 p-4 ring-1 ring-slate-800">
    <h2 className="mb-2 font-semibold">{name}</h2>
    {children}
  </section>
)

/** A latency against its budget (spec §2): the p95, and whether it is within the budget. */
const Latency = ({ name, b, note, lang }: { name: string; b: Budget; note?: string; lang: Lang }) => (
  <Tile name={name}>
    {b.ok === null ? (
      <p className="text-slate-400">{t(lang, "noData")}</p>
    ) : (
      <>
        <p className={`inline-block rounded px-2 py-0.5 text-sm font-semibold ${b.ok ? "bg-emerald-700" : "bg-red-700"}`}>{t(lang, b.ok ? "withinBudget" : "overBudget")}</p>
        {b.p95 !== null && (
          <>
            <p className="mt-2 text-2xl font-bold tabular-nums">{`p95 ${b.p95} ms / ${b.budget_ms} ms`}</p>
            <p className="text-sm tabular-nums text-slate-400">{`n ${b.n} · p50 ${b.p50} ms · max ${b.max} ms`}</p>
          </>
        )}
        {b.missed > 0 && <p className="mt-1 text-sm font-semibold text-red-300">{`${b.missed} ${t(lang, "missed")}`}</p>}
      </>
    )}
    {note && <p className="mt-1 text-xs text-slate-400">{note}</p>}
  </Tile>
)

const Counts = ({ counts, lang }: { counts: Readonly<Record<string, number>>; lang: Lang }) => {
  const entries = Object.entries(counts)
  return entries.length === 0 ? <p className="text-slate-400">{t(lang, "none")}</p> : <ul className="text-sm">{entries.map(([k, n]) => <li key={k} className="tabular-nums">{`${k}: ${n}`}</li>)}</ul>
}

/**
 * The ops view (spec §5.6): for one session, as of its frame, the latency of the hot path and the agents against the
 * spec's budgets, the Fact-Checker's verdicts, time per agent, requests, fallbacks and late or unverified cues.
 */
export const Ops = ({ client, session, lang }: { client: TouchlineClient; session: string; lang: Lang }) => {
  const [report, setReport] = useState<OpsReport | null | "gone">(null)
  useEffect(() => {
    let alive = true
    const load = () => client.ops(session).then((r) => alive && setReport(r), () => alive && setReport("gone"))
    load()
    const id = setInterval(load, OPS_POLL_MS)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [client, session])
  if (report === "gone") return <main className="p-6"><p role="status">{t(lang, "gone")}</p></main>
  if (report === null) return <main className="p-6"><p>{t(lang, "loading")}</p></main>
  const r = report
  return (
    <main className="mx-auto grid max-w-6xl gap-4 p-6 font-sans md:grid-cols-2 lg:grid-cols-3">
      <header className="flex flex-wrap items-center gap-3 md:col-span-2 lg:col-span-3">
        <h1 className="text-2xl font-bold">{t(lang, "opsView")}</h1>
        <span className="rounded bg-slate-800 px-2 py-0.5 text-sm">{t(lang, r.live ? "live" : "recorded")}</span>
        {r.models.map((m) => <span key={m} className="rounded bg-slate-800 px-2 py-0.5 font-mono text-xs">{m}</span>)}
        <span className="text-sm tabular-nums text-slate-400">{`${t(lang, "moments")} ${r.moments} · ${t(lang, "cues")} ${r.cues}`}</span>
      </header>
      <Latency name={t(lang, "statsLatency")} b={r.latency.stats} lang={lang} />
      <Latency name={t(lang, "insightLatency")} b={r.latency.insight} lang={lang} {...(r.latency.insight.source === "recorded" ? { note: t(lang, "recordedRequests") } : {})} />
      <Tile name={t(lang, "factCheck")}>
        <dl className="grid grid-cols-3 gap-2 text-center">
          {(["pass", "retry", "drop"] as const).map((k) => (
            <div key={k}>
              <dt className="text-sm text-slate-400">{t(lang, k === "pass" ? "fcPass" : k === "retry" ? "fcRetry" : "fcDrop")}</dt>
              <dd className="text-2xl font-bold tabular-nums" data-testid={k}>{r.fact_check[k]}</dd>
            </div>
          ))}
        </dl>
      </Tile>
      <Tile name={t(lang, "agentTimes")}>
        <table className="w-full text-sm tabular-nums">
          <thead><tr className="text-slate-400"><th className="text-left">{t(lang, "agent")}</th><th className="pl-3 text-right">n</th><th className="pl-3 text-right">p50 ms</th><th className="pl-3 text-right">p95 ms</th></tr></thead>
          <tbody>
            {r.agents.map((a) => (
              <tr key={a.agent}><td>{a.agent}</td><td className="pl-3 text-right">{a.n}</td><td className="pl-3 text-right">{a.p50}</td><td className="pl-3 text-right">{a.p95}</td></tr>
            ))}
          </tbody>
        </table>
      </Tile>
      <Tile name={t(lang, "requests")}>
        <Counts counts={r.requests} lang={lang} />
        <p className="mt-2 text-sm tabular-nums">{`${t(lang, "lateCues")}: ${r.late_cues} · ${t(lang, "unverifiedCues")}: ${r.unverified_cues}`}</p>
      </Tile>
      <Tile name={t(lang, "fallbacks")}>
        <Counts counts={r.fallbacks} lang={lang} />
      </Tile>
    </main>
  )
}
