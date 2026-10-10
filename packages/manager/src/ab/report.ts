/**
 * The A/B report (spec §5): the managed team's xG difference per match (primary, declared before the run), goal
 * difference and points as paired differences between arms with bootstrap intervals, win rates with Wilson
 * intervals, and what the agent cost and how it behaved. The headline follows the interval, whatever it says.
 */
import type { Decision } from "@touchline/schema"
import type { Arm, MatchResult } from "./match.js"
import { pairedBootstrap, percentile, verdict, wilson, type Interval } from "./stats.js"

export interface AbMeta {
  readonly generated: string
  readonly first_seed: number
  readonly seeds: number
  readonly arms: ReadonlyArray<Arm>
  readonly model: string
  readonly whatif: { readonly seeds: number; readonly horizon_s: number }
}

const COMPARISONS: ReadonlyArray<readonly [Arm, Arm]> = [["agent", "none"], ["agent", "rules"], ["rules", "none"]]
const METRICS = ["xg_diff", "goal_diff", "points"] as const

const bySeed = (results: ReadonlyArray<MatchResult>, arm: Arm) => new Map(results.filter((r) => r.arm === arm).map((r) => [r.seed, r]))

/** Paired differences `a − b` of a metric over the seeds both arms played. */
const paired = (results: ReadonlyArray<MatchResult>, a: Arm, b: Arm, metric: (typeof METRICS)[number]) => {
  const A = bySeed(results, a), B = bySeed(results, b)
  return [...A.keys()].filter((s) => B.has(s)).sort((x, y) => x - y).map((s) => A.get(s)![metric] - B.get(s)![metric])
}

const share = (k: number, n: number) => (n === 0 ? null : k / n)

/** How a set of decisions behaved (one arm's). */
export const decisionStats = (decisions: ReadonlyArray<Decision>, matches: number) => {
  const n = decisions.length
  const called = (k: "propose" | "choose") => decisions.map((d) => d.timings_ms[k]).filter((ms) => ms > 0)
  const total = decisions.map((d) => d.timings_ms.propose + d.timings_ms.whatif + d.timings_ms.choose)
  const agentOptions = decisions.flatMap((d) => d.options.filter((o) => o.source === "agent"))
  const candidates = decisions.flatMap((d) => d.options.filter((o) => o.index > 0))
  const tested = decisions.filter((d) => d.options.some((o) => o.index > 0 && o.xg_diff_vs_no_change !== null))
  const bestPick = tested.filter((d) => {
    const best = d.options.filter((o) => o.xg_diff_vs_no_change !== null && !o.untested).reduce((a, o) => (o.xg_diff_vs_no_change!.mean > a.xg_diff_vs_no_change!.mean ? o : a))
    return d.pick === best.index
  })
  const sum = (f: (d: Decision) => number) => decisions.reduce((a, d) => a + f(d), 0)
  return {
    decisions: n,
    per_match: share(n, matches),
    no_change_rate: share(decisions.filter((d) => d.pick === 0).length, n),
    fallback_rate: {
      propose: share(decisions.filter((d) => d.fallback === "propose").length, n),
      choose: share(decisions.filter((d) => d.fallback === "choose").length, n),
      service: share(decisions.filter((d) => d.fallback === "service").length, n)
    },
    dropped_option_rate: share(agentOptions.filter((o) => o.dropped.length > 0).length, agentOptions.length),
    /** Options whose re-simulation failed or ran out of time (the agent could not weigh them). */
    untested_option_rate: share(candidates.filter((o) => o.untested).length, candidates.length),
    best_pick_rate: share(bestPick.length, tested.length),
    latency_ms: {
      propose: { p50: percentile(called("propose"), 0.5), p95: percentile(called("propose"), 0.95) },
      choose: { p50: percentile(called("choose"), 0.5), p95: percentile(called("choose"), 0.95) },
      decision: { p50: percentile(total, 0.5), p95: percentile(total, 0.95) }
    },
    tokens_per_match: { in: share(sum((d) => d.tokens.in), matches), out: share(sum((d) => d.tokens.out), matches) },
    cost_usd_per_match: share(sum((d) => d.cost_usd), matches)
  }
}

export const summarize = (results: ReadonlyArray<MatchResult>, meta: AbMeta) => {
  const arms = meta.arms.filter((a) => results.some((r) => r.arm === a))
  const perArm = Object.fromEntries(arms.map((arm) => {
    const rs = results.filter((r) => r.arm === arm)
    const avg = (m: (typeof METRICS)[number]) => rs.reduce((a, r) => a + r[m], 0) / rs.length
    return [arm, {
      matches: rs.length,
      xg_diff: avg("xg_diff"), goal_diff: avg("goal_diff"), points: avg("points"),
      win_rate: wilson(rs.filter((r) => r.points === 3).length, rs.length),
      draws: rs.filter((r) => r.points === 1).length, losses: rs.filter((r) => r.points === 0).length,
      ...(arm === "none" ? {} : { decisions: decisionStats(rs.flatMap((r) => r.decisions), rs.length) })
    }]
  }))
  const comparisons = COMPARISONS.filter(([a, b]) => arms.includes(a) && arms.includes(b)).map(([a, b]) => {
    const m = Object.fromEntries(METRICS.map((k) => [k, pairedBootstrap(paired(results, a, b, k))])) as Record<(typeof METRICS)[number], Interval>
    return { a, b, ...m, verdict: verdict(m.xg_diff) }
  })
  return { meta, primary_metric: "xg_diff" as const, arms: perArm, comparisons }
}

export type AbSummary = ReturnType<typeof summarize>

const f2 = (x: number | null) => (x === null || Number.isNaN(x) ? "–" : x.toFixed(2))
const f3 = (x: number) => (Number.isNaN(x) ? "–" : x.toFixed(3))
const pct = (x: number | null) => (x === null || Number.isNaN(x) ? "–" : `${(100 * x).toFixed(0)} %`)
const ci = (i: Interval, f = f3) => `${f(i.mean)} [${f(i.lo)}, ${f(i.hi)}]`
const ms = (x: number) => (Number.isNaN(x) ? "–" : `${(x / 1000).toFixed(1)} s`)
const NAMES: Record<Arm, string> = { none: "no manager", rules: "rule-based manager", agent: "agent manager" }

/** The headline: the agent against the rules if both ran, else the first comparison; in the interval's words. */
export const headline = (s: AbSummary): string => {
  const c = s.comparisons.find((x) => x.a === "agent" && x.b === "rules") ?? s.comparisons[0]
  if (!c) return "No comparison: fewer than two arms ran."
  const words = c.verdict === "better" ? "does better than" : c.verdict === "worse" ? "does worse than" : "shows no detectable difference from"
  return `The ${NAMES[c.a]} ${words} the ${NAMES[c.b]}: ${f3(c.xg_diff.mean)} xG difference per match (95 % interval ${f3(c.xg_diff.lo)} to ${f3(c.xg_diff.hi)}, ${c.xg_diff.n} paired matches).`
}

export const markdown = (s: AbSummary): string => {
  const m = s.meta
  const out = [
    "# Manager agents: A/B evaluation",
    "",
    `Generated ${m.generated} by \`pnpm managers:ab\`. Seeds ${m.first_seed}–${m.first_seed + m.seeds - 1} (${m.seeds}); arms: ${m.arms.join(", ")}; agent model: ${m.model}; options tested on ${m.whatif.seeds} forks over ${m.whatif.horizon_s / 60} minutes.`,
    "",
    "Each seed is one fixture played once per arm. Only the managed team's manager changes between arms; the opponent never has one, and the arms are the same match until the first key moment. The primary metric, declared before the run, is the managed team's xG difference per match (the engine's shot xG). Intervals are 95 %: paired bootstrap (10,000 resamples) for differences, Wilson for win rates.",
    "",
    `**${headline(s)}**`,
    "",
    "## Paired differences",
    "",
    "| Comparison | xG difference | Goal difference | Points | Verdict (xG) |",
    "|---|---|---|---|---|",
    ...s.comparisons.map((c) => `| ${NAMES[c.a]} − ${NAMES[c.b]} | ${ci(c.xg_diff)} | ${ci(c.goal_diff)} | ${ci(c.points)} | ${c.verdict} |`),
    "",
    "## Per arm",
    "",
    "| Arm | Matches | xG difference | Goal difference | Points per match | Win rate | Draws | Losses |",
    "|---|---|---|---|---|---|---|---|",
    ...Object.entries(s.arms).map(([arm, a]) => `| ${NAMES[arm as Arm]} | ${a.matches} | ${f3(a.xg_diff)} | ${f3(a.goal_diff)} | ${f2(a.points)} | ${ci(a.win_rate, (x) => pct(x))} | ${a.draws} | ${a.losses} |`)
  ]
  for (const arm of ["agent", "rules"] as const) {
    const d = (s.arms[arm] as { decisions?: ReturnType<typeof decisionStats> } | undefined)?.decisions
    if (!d) continue
    out.push("", `## The ${NAMES[arm]}'s decisions`, "")
    out.push(`- ${d.decisions} decisions (${f2(d.per_match)} per match); "no change" picked ${pct(d.no_change_rate)}.`)
    if (arm === "agent") {
      const priced = d.cost_usd_per_match !== null && d.cost_usd_per_match > 0
      out.push(
        `- Fallbacks: propose ${pct(d.fallback_rate.propose)}, choose ${pct(d.fallback_rate.choose)}, service ${pct(d.fallback_rate.service)} of decisions.`,
        `- Options with orders the engine refused: ${pct(d.dropped_option_rate)}. Options that could not be tested: ${pct(d.untested_option_rate)}. Picked the option with the best what-if xG: ${pct(d.best_pick_rate)}.`,
        `- Latency: propose p50 ${ms(d.latency_ms.propose.p50)} / p95 ${ms(d.latency_ms.propose.p95)}; choose p50 ${ms(d.latency_ms.choose.p50)} / p95 ${ms(d.latency_ms.choose.p95)}; whole decision p50 ${ms(d.latency_ms.decision.p50)} / p95 ${ms(d.latency_ms.decision.p95)}.`,
        `- Tokens per match: ${f2(d.tokens_per_match.in)} in, ${f2(d.tokens_per_match.out)} out. Cost per match: ${priced ? `$${d.cost_usd_per_match!.toFixed(4)}` : "not known (no price configured: TOUCHLINE_PRICE_USD_PER_MTOK)"}.`
      )
    }
  }
  return out.join("\n") + "\n"
}
