/**
 * The rule-based manager (spec §2.3): the A/B baseline a sensible human would write. It reads the same Situation as
 * the agent and decides without re-simulation:
 *   losing                → press more and play quicker; fresh attackers for the most tired midfielders and forwards;
 *   winning from minute 60 → drop the line and tighten the block; tired players replaced role for role;
 *   otherwise             → players below 60 % energy replaced role for role.
 * No substitutions before half time. A substitute takes the slot and role of the player going off (the formation is
 * fixed), so an attacker only ever replaces a midfielder or a forward.
 */
import { Effect } from "effect"
import type { ManagerOrder, Situation, StyleKey } from "@touchline/schema"
import { checkedOption, decisionBase, NO_CHANGE, type DecideInput, type Manager } from "./decision.js"

/** Energy (%) below which a player is replaced. */
export const TIRED_PCT = 60
/** When chasing, energy (%) below which a player makes way for an attacker. */
export const CHASE_TIRED_PCT = 75
/** Substitutions per decision. */
export const SUBS_PER_DECISION = 2

const LINE: Readonly<Record<string, string>> = { GK: "gk", CB: "def", FB: "def", DM: "mid", CM: "mid", AM: "mid", W: "att", ST: "att" }
const ATTACKERS = ["ST", "W", "AM"]
const OUTFIELD = ["CB", "FB", "DM", "CM", "AM", "W", "ST"]
const MIDFIELD_AND_ATTACK = ["DM", "CM", "AM", "W", "ST"]

const styleValue = (sit: Situation, k: StyleKey) => sit.team.style.find((s) => s.setting === k)!.value
const clamp = (sit: Situation, k: StyleKey, v: number) => {
  const s = sit.team.style.find((x) => x.setting === k)!
  return Math.round(Math.min(s.max, Math.max(s.min, v)) * 100) / 100
}
const nudge = (sit: Situation, k: StyleKey, by: number): ManagerOrder[] => {
  const v = clamp(sit, k, styleValue(sit, k) + by)
  return v === styleValue(sit, k) ? [] : [{ kind: "style", setting: k, value: v }]
}

/** Up to SUBS_PER_DECISION substitutions: the most tired of `roles` under `below` %, each for a bench player `pick` chooses. */
const subs = (sit: Situation, below: number, roles: ReadonlyArray<string>, pick: (role: string, bench: Situation["players"]["bench"]) => Situation["players"]["bench"][number] | undefined): ManagerOrder[] => {
  const canSub = sit.limits.subs_left > 0 && (sit.limits.half_time_break || (sit.moment.minute >= 45 && sit.limits.windows_left > 0))
  if (!canSub) return []
  let bench = sit.players.bench.filter((b) => b.available && b.role !== "GK")
  const out: ManagerOrder[] = []
  const tired = sit.players.on_pitch.filter((p) => roles.includes(p.role) && p.energy_pct < below).sort((a, b) => a.energy_pct - b.energy_pct || a.id.localeCompare(b.id))
  for (const p of tired) {
    if (out.length >= Math.min(SUBS_PER_DECISION, sit.limits.subs_left)) break
    const on = pick(p.role, bench)
    if (!on) continue
    bench = bench.filter((b) => b.id !== on.id)
    out.push({ kind: "sub", off: p.id, on: on.id })
  }
  return out
}

const roleForRole = (role: string, bench: Situation["players"]["bench"]) => bench.find((b) => b.role === role) ?? bench.find((b) => LINE[b.role] === LINE[role])
const attacker = (_role: string, bench: Situation["players"]["bench"]) => ATTACKERS.map((r) => bench.find((b) => b.role === r)).find((b) => b !== undefined)

/** The rules' option for this situation, or null when they would change nothing. */
export const rulesOption = (sit: Situation): { readonly label: string; readonly orders: ManagerOrder[]; readonly rationale: string } | null => {
  const diff = sit.moment.score.for - sit.moment.score.against
  if (diff < 0) {
    const orders = [...nudge(sit, "pressIntensity", 0.2), ...nudge(sit, "tempo", 0.2), ...subs(sit, CHASE_TIRED_PCT, MIDFIELD_AND_ATTACK, attacker)]
    return orders.length === 0 ? null : { label: "Chase the game", orders, rationale: "Behind: press higher, play quicker, fresh attackers for tired legs." }
  }
  if (diff > 0 && sit.moment.minute >= 60) {
    const orders = [...nudge(sit, "lineHeight", -0.3), ...nudge(sit, "compactness", 0.2), ...subs(sit, TIRED_PCT, OUTFIELD, roleForRole)]
    return orders.length === 0 ? null : { label: "Protect the lead", orders, rationale: "Ahead late on: deeper line, tighter block, tired players replaced." }
  }
  const orders = subs(sit, TIRED_PCT, OUTFIELD, roleForRole)
  return orders.length === 0 ? null : { label: "Fresh legs", orders, rationale: "Tired players replaced role for role." }
}

/** The rule-based manager: one option or none, applied without testing. */
export const rulesManager: Manager = {
  kind: "rules",
  decide: (input: DecideInput) =>
    Effect.sync(() => {
      const opt = rulesOption(input.situation)
      const options = opt ? [NO_CHANGE, checkedOption(input, 1, opt, "rules")] : [NO_CHANGE]
      const pick = options.length > 1 && options[1]!.orders.length > 0 ? 1 : 0
      return {
        ...decisionBase(input),
        manager: "rules" as const,
        options,
        pick,
        reason: pick === 0 ? "No rule applies." : options[1]!.rationale!,
        orders_applied: options[pick]!.orders,
        fallback: null,
        timings_ms: { propose: 0, whatif: 0, choose: 0 },
        tokens: { in: 0, out: 0 },
        cost_usd: 0,
        model: "rules"
      }
    })
}
