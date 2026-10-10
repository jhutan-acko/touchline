/**
 * The agent manager (spec §2.3, §3): at a key moment it asks the Python manager agent to propose changes, has the
 * engine test each against "no change", and asks the agent to choose. Failures never stop the match:
 *   propose fails (a fallback reply, nothing valid) → the rule-based option stands in, then testing and choosing go on;
 *   choose fails                                   → the previous plan stays (no change);
 *   the service cannot be reached, or the circuit is open after repeated failures → the previous plan stays.
 */
import { Effect } from "effect"
import { manage, type Sender } from "@touchline/agent-gateway"
import type { Decision, ManageRequest, ManagerReply } from "@touchline/schema"
import { checkedOption, decisionBase, NO_CHANGE, type DecideInput, type DecisionOption, type Manager } from "./decision.js"
import { rulesOption } from "./rules.js"
import { testOptions, whatIfSummary, type TestOptions } from "./whatif.js"

export interface AgentManagerOptions {
  /** Milliseconds one manage call may take (the agent's own model timeout is 30 s). */
  readonly callTimeoutMs?: number
  readonly whatif?: TestOptions
  /** After `failures` decisions in a row that could not reach the service, skip it for the next `cooldown` decisions. */
  readonly breaker?: { readonly failures: number; readonly cooldown: number }
}

const DEFAULTS = { callTimeoutMs: 45_000, breaker: { failures: 3, cooldown: 4 } }

/** A call's outcome: the reply, or why the service could not give one. */
type Called = { readonly reply: ManagerReply; readonly ms: number } | { readonly unavailable: string; readonly ms: number }

export const agentManager = (send: Sender, config: AgentManagerOptions = {}): Manager => {
  const callTimeoutMs = config.callTimeoutMs ?? DEFAULTS.callTimeoutMs
  const breaker = config.breaker ?? DEFAULTS.breaker
  let failures = 0
  let skip = 0

  const call = (req: ManageRequest): Effect.Effect<Called> =>
    Effect.gen(function* () {
      const t0 = performance.now()
      const exit = yield* Effect.exit(manage(send, req, callTimeoutMs))
      const ms = performance.now() - t0
      if (exit._tag === "Success") return { reply: exit.value, ms }
      return { unavailable: String(exit.cause), ms }
    })

  return {
    kind: "agent",
    decide: (input: DecideInput) =>
      Effect.gen(function* () {
        const base = decisionBase(input)
        const timings = { propose: 0, whatif: 0, choose: 0 }
        let tokensIn = 0, tokensOut = 0, cost = 0, model = "unavailable"
        const account = (r: ManagerReply) => {
          tokensIn += r.tokens_in
          tokensOut += r.tokens_out
          cost += r.cost_usd
          model = r.model
        }
        const done = (options: DecisionOption[], pick: number, reason: string, fallback: Decision["fallback"]): Decision => ({
          ...base, manager: "agent", options, pick, reason, orders_applied: options[pick]!.orders, fallback,
          timings_ms: { propose: Math.round(timings.propose), whatif: Math.round(timings.whatif), choose: Math.round(timings.choose) },
          tokens: { in: tokensIn, out: tokensOut }, cost_usd: cost, model
        })
        const request = (task: ManageRequest["task"], whatif: ManageRequest["whatif"]): ManageRequest => ({ kind: "manage", task, match_id: base.match_id, situation: input.situation, whatif })
        const unreachable = (reason: string) => {
          failures += 1
          if (failures >= breaker.failures) skip = breaker.cooldown
          return done([NO_CHANGE], 0, `The manager agent could not be reached (${reason.slice(0, 120)}); the previous plan stays.`, "service")
        }

        if (skip > 0) {
          skip -= 1
          if (skip === 0) failures = 0
          return done([NO_CHANGE], 0, "The manager agent is paused after repeated failures; the previous plan stays.", "service")
        }

        // 1. Propose.
        const proposed = yield* call(request("propose", null))
        timings.propose = proposed.ms
        if ("unavailable" in proposed) return unreachable(proposed.unavailable)
        failures = 0
        account(proposed.reply)
        let fallback: Decision["fallback"] = null
        let options: DecisionOption[] = (proposed.reply.proposal?.options ?? []).map((o, i) => checkedOption(input, i + 1, o, "agent"))
        if (proposed.reply.fallback || options.every((o) => o.orders.length === 0)) {
          fallback = "propose"
          const rules = rulesOption(input.situation)
          options = rules ? [checkedOption(input, 1, rules, "rules")] : []
        }
        const all = [NO_CHANGE, ...options]
        if (options.length === 0) return done(all, 0, "No option to test; the previous plan stays.", fallback)

        // 2. Test every option against no change.
        const t0 = performance.now()
        const tested = yield* testOptions(input.state, input.side, all, config.whatif)
        timings.whatif = performance.now() - t0

        // 3. Choose.
        const chosen = yield* call(request("choose", whatIfSummary(tested, config.whatif)))
        timings.choose = chosen.ms
        if ("unavailable" in chosen) return { ...unreachable(chosen.unavailable), options: tested }
        account(chosen.reply)
        const c = chosen.reply.choice
        const pick = c && tested[c.pick] && !tested[c.pick]!.untested ? c.pick : null
        if (chosen.reply.fallback || pick === null) return done(tested, 0, "The manager agent could not choose; the previous plan stays.", "choose")
        return done(tested, pick, c!.reason, fallback)
      })
  }
}
