/**
 * Suggested questions for a paused frame (pause-and-ask): up to four chips built from the frame summary alone, in the
 * viewer's language, each with its intent already classified (asking a chip skips the question agent). Pure and
 * deterministic: the same summary and language give the same chips.
 */
import type { QuestionChip } from "@touchline/rpc"
import type { AskIntent, FrameSummary, Lang as LangSchema } from "@touchline/schema"

type Lang = typeof LangSchema.Type

export type Chip = typeof QuestionChip.Type

/** The clubs' names by side, for the plan chip (without them it asks about "the plan"). */
export interface TeamNames {
  readonly home: string
  readonly away: string
}

type Texts = {
  readonly why_not_pass: (passer: string, receiver: string) => string
  readonly what_if_pass: (holder: string, receiver: string) => string
  readonly pressers: (holder: string) => string
  readonly plan: (team: string) => string
  readonly plan_unnamed: string
}

/** Every chip text, in every viewer language. */
export const CHIP_TEXTS: Readonly<Record<Lang, Texts>> = {
  en: {
    why_not_pass: (p, r) => `Why didn't ${p} pass to ${r}?`,
    what_if_pass: (h, r) => `What if ${h} passed to ${r}?`,
    pressers: (h) => `Who's pressing ${h}?`,
    plan: (t) => `What are ${t} trying to do here?`,
    plan_unnamed: "What's the plan here?"
  },
  es: {
    why_not_pass: (p, r) => `¿Por qué ${p} no le pasó a ${r}?`,
    what_if_pass: (h, r) => `¿Y si ${h} le hubiera pasado a ${r}?`,
    pressers: (h) => `¿Quién presiona a ${h}?`,
    plan: (t) => `¿Qué intenta hacer ${t} aquí?`,
    plan_unnamed: "¿Cuál es el plan aquí?"
  },
  hi: {
    why_not_pass: (p, r) => `${p} ने ${r} को पास क्यों नहीं दिया?`,
    what_if_pass: (h, r) => `अगर ${h} ने ${r} को पास दिया होता तो?`,
    pressers: (h) => `${h} पर दबाव कौन बना रहा है?`,
    plan: (t) => `${t} यहाँ क्या करने की कोशिश कर रहे हैं?`,
    plan_unnamed: "यहाँ क्या योजना है?"
  }
}

/** At most this many chips. */
export const MAX_CHIPS = 4

const intent = (kind: "explain" | "what_if", subject: string | null, fork: string | null, pass: { from: string; to: string } | null): AskIntent => ({
  kind,
  subject_id: subject,
  fork_event_id: fork,
  intervention: pass ? { kind: "pass_to", player_id: pass.from, receiver_id: pass.to } : null,
  reason: null
})

/**
 * The chips for a paused frame, in this order, each only when its condition holds: why the newest pass by the side in
 * possession did not go to the better option (summary.missed_option), what if the holder passed to his best option,
 * who is pressing the holder (two or more pressers), and what the team on the ball is trying to do (always).
 */
export const suggestChips = (summary: FrameSummary, lang: Lang, teams?: TeamNames): Chip[] => {
  const t = CHIP_TEXTS[lang]
  const name = (id: string) => summary.players.find((p) => p.id === id)?.name ?? id
  const chip = (slug: string, text: string, i: AskIntent): Chip => ({ chip_id: `${summary.frame}:${slug}`, text, intent: i })
  const chips: Chip[] = []
  const m = summary.missed_option
  if (m) chips.push(chip("why_not_pass", t.why_not_pass(name(m.passer_id), name(m.better_to)), intent("what_if", m.passer_id, m.event_id, { from: m.passer_id, to: m.better_to })))
  const holder = summary.ball_holder
  const best = summary.pass_options[0]
  if (holder !== null && best) chips.push(chip("what_if_pass", t.what_if_pass(name(holder), name(best.receiver_id)), intent("what_if", holder, null, { from: holder, to: best.receiver_id })))
  if (holder !== null && summary.pressers.length >= 2) chips.push(chip("pressers", t.pressers(name(holder)), intent("explain", holder, null, null)))
  const side = summary.side_in_possession
  chips.push(chip("plan", side && teams ? t.plan(teams[side]) : t.plan_unnamed, intent("explain", null, null, null)))
  return chips.slice(0, MAX_CHIPS)
}
