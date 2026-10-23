import { useEffect, useRef, useState, type FormEvent } from "react"
import type { AskAnswer, AskUpdate, PassVerdict } from "@touchline/rpc"
import type { Segment } from "@touchline/schema"
import type { QuestionChip, TouchlineClient } from "./client.js"
import { t, type Key, type Lang } from "./i18n.js"
import type { Marker } from "./markers.js"

type StageName = Extract<AskUpdate, { kind: "stage" }>["stage"]["stage"]
type FailReason = Extract<AskUpdate, { kind: "failed" }>["reason"]

/** The agents an answer goes through, in the order the panel lists them (the what-if row only when one runs). */
const STAGES: ReadonlyArray<StageName> = ["question", "whatif", "analyst", "factcheck", "personalise"]
const STAGE_KEY: Record<StageName, Key> = { question: "stageQuestion", whatif: "stageWhatif", analyst: "stageAnalyst", factcheck: "stageFactcheck", personalise: "stagePersonalise" }
const FAIL_KEY: Record<FailReason, Key> = { offline: "askOffline", timeout: "askTimeout", bad_frame: "askBadFrame" }
/** The verdict in the words the answer team uses. */
export const VERDICT_KEY: Record<PassVerdict, Key> = { better_option_found: "verdictBetter", played_pass_was_best: "verdictBest", not_verified: "verdictClose" }

/** The question a tapped pitch marker asks, in the viewer's language (`names`: player id to the name to show). */
export const markerQuestion = (m: Marker, names: Record<string, string>, lang: Lang): string => {
  const name = (id: string | undefined) => (id ? names[id] ?? id : t(lang, "askSomeone"))
  const [key, id]: [Key, string | undefined] = m.template === "ghost" ? ["askGhost", m.at] : m.template === "pressure_ring" ? ["askRing", m.at] : ["askArc", m.to]
  return t(lang, key).replace("{name}", name(id))
}

type Ask = {
  /** Each stage heard from, with its latest status line, in arrival order. */
  readonly stages: ReadonlyArray<{ readonly stage: StageName; readonly status: string }>
  readonly answer: AskAnswer | null
  readonly failed: FailReason | null
}

/**
 * Pause and ask (mockup D): a card over the paused picture with suggested questions for the frame, a text box, the
 * agents working on the answer (each pending, then working, then done), and the answer: headline, body, its checked
 * numbers, "Fact-checked ✓" when every claim passed, the what-if verdict, and Show me when there is a clip. A new
 * question stops the one before it.
 */
export const AskPanel = ({ client, sessionId, frame, segment, prefill, onShowMe, onClose }: {
  client: TouchlineClient
  sessionId: string
  frame: number
  segment: Segment
  prefill?: string
  onShowMe: (clipId: string) => void
  onClose: () => void
}) => {
  const lang: Lang = segment.lang
  const [chips, setChips] = useState<ReadonlyArray<QuestionChip>>([])
  const [text, setText] = useState(prefill ?? "")
  const [ask, setAsk] = useState<Ask | null>(null)
  useEffect(() => void (prefill !== undefined && setText(prefill)), [prefill])
  useEffect(() => {
    let live = true
    client.suggest(sessionId, frame, lang).then((c) => live && setChips(c), () => live && setChips([])) // no chips: the text box still works
    return () => void (live = false)
  }, [client, sessionId, frame, lang])
  // The stream in flight: stopped by a newer question or when the panel closes; a stopped stream's late updates are dropped.
  const current = useRef<{ stop: () => void } | null>(null)
  useEffect(() => () => current.current?.stop(), [])
  const start = (question: string, chipId: string | null) => {
    if (!question.trim()) return
    current.current?.stop()
    const me = { stop: () => {} }
    current.current = me
    const mine = () => current.current === me
    setAsk({ stages: [], answer: null, failed: null })
    const onUpdate = (u: AskUpdate) => {
      if (!mine()) return
      setAsk((a) => {
        const s = a ?? { stages: [], answer: null, failed: null }
        switch (u.kind) {
          case "stage": {
            const seen = s.stages.some((x) => x.stage === u.stage.stage)
            return { ...s, stages: seen ? s.stages.map((x) => (x.stage === u.stage.stage ? u.stage : x)) : [...s.stages, u.stage] }
          }
          case "answer":
            return { ...s, answer: u.answer, failed: null }
          case "failed":
            return { ...s, failed: u.reason }
        }
      })
    }
    // Ending with neither an answer nor a failure: the agents are not there.
    const onEnd = () => void (mine() && setAsk((a) => (a && !a.answer && !a.failed ? { ...a, failed: "offline" } : a)))
    const stop = client.ask(sessionId, { frame, question, chip_id: chipId, segment }, onUpdate, onEnd)
    me.stop = () => {
      current.current = current.current === me ? null : current.current
      stop()
    }
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    start(text, null)
  }
  const stateOf = (name: StageName): "pending" | "working" | "done" => {
    if (!ask) return "pending"
    const i = ask.stages.findIndex((x) => x.stage === name)
    if (i < 0) return ask.answer ? "done" : "pending"
    return ask.answer || i < ask.stages.length - 1 ? "done" : "working"
  }
  const shownStages = STAGES.filter((s) => s !== "whatif" || ask?.stages.some((x) => x.stage === "whatif"))
  const answer = ask?.answer ?? null
  return (
    <section aria-label={t(lang, "ask")} lang={lang} className="pointer-events-auto flex max-h-full flex-col gap-3 overflow-y-auto rounded-xl border border-white/10 bg-slate-950/80 p-3 text-sm shadow-xl backdrop-blur">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">{t(lang, "ask")}</h2>
        <button type="button" className="rounded px-2 text-slate-400 hover:text-white" aria-label={t(lang, "close")} onClick={onClose}>×</button>
      </div>
      {chips.length > 0 && (
        <div role="group" aria-label={t(lang, "askSuggested")} className="flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <button key={c.chip_id} type="button" className="rounded-full bg-slate-800 px-3 py-1 text-left hover:bg-slate-700" onClick={() => start(c.text, c.chip_id)}>{c.text}</button>
          ))}
        </div>
      )}
      <form className="flex gap-1.5" onSubmit={submit}>
        <input aria-label={t(lang, "askBox")} placeholder={t(lang, "askPlaceholder")} className="min-w-0 flex-1 rounded bg-slate-800 px-2 py-1" value={text} onChange={(e) => setText(e.target.value)} />
        <button type="submit" className="rounded bg-emerald-600 px-3 py-1 text-white">{t(lang, "askSend")}</button>
      </form>
      {ask && (
        <ol aria-label={t(lang, "askAgents")} className="flex flex-col gap-1">
          {shownStages.map((name) => {
            const state = stateOf(name)
            const status = ask.stages.find((x) => x.stage === name)?.status
            return (
              <li key={name} data-stage={name} data-state={state} className={`flex items-baseline gap-2 ${state === "pending" ? "text-slate-500" : ""}`}>
                <span aria-hidden className={`w-4 text-center ${state === "done" ? "text-emerald-400" : state === "working" ? "animate-pulse text-amber-400" : ""}`}>{state === "done" ? "✓" : state === "working" ? "●" : "○"}</span>
                <span className="font-medium">{t(lang, STAGE_KEY[name])}</span>
                {status && <span className="truncate text-slate-400">{status}</span>}
              </li>
            )
          })}
        </ol>
      )}
      {ask?.failed && <p role="alert" className="rounded bg-amber-900/60 px-2 py-1">{t(lang, FAIL_KEY[ask.failed])}</p>}
      {answer && (
        <article className="flex flex-col gap-2 rounded-lg bg-slate-900/90 p-3">
          <h3 className="text-base font-semibold">{answer.headline}</h3>
          {answer.body && <p>{answer.body}</p>}
          {answer.chips.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {answer.chips.slice(0, 4).map((c, i) => (
                <li key={i} data-testid="evidence-chip" className="rounded bg-slate-800 px-2 py-0.5">
                  <span className="text-slate-400">{c.label}</span> <span className="font-semibold tabular-nums">{c.value}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {answer.verified && <span className="text-emerald-400">{t(lang, "factChecked")}</span>}
            {answer.verdict && <span className="font-medium text-amber-300">{t(lang, VERDICT_KEY[answer.verdict])}</span>}
            {answer.clip_id && (
              <button type="button" className="ml-auto rounded bg-amber-400 px-3 py-1 font-semibold text-slate-950" onClick={() => onShowMe(answer.clip_id!)}>{t(lang, "showMe")}</button>
            )}
          </div>
        </article>
      )}
    </section>
  )
}
