/**
 * touchline-managers-ab: the A/B evaluation of the manager agents (spec §5).
 *   pnpm managers:ab --seeds 120 --llm openai        the full run (spends model credit)
 *   pnpm managers:ab --seeds 4 --llm stub --out out/ab-ci   the pipeline on the stub model
 * Writes <out>/manager-ab.md and manager-ab.json (summary and per-match results) and, under out/manager-ab/, every
 * decision made (decisions.jsonl) so any match can be inspected or replayed.
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { Effect } from "effect"
import { cliOptions, exitOnUserError, CliError, integer, oneOf, positiveInteger } from "@touchline/sim"
import { AB_FIRST_SEED, ARMS, type Arm } from "./match.js"
import { markdown, summarize } from "./report.js"
import { runAb, startAgents } from "./run.js"
import { root } from "./setup.js"

const here = (p: string) => resolve(process.env.INIT_CWD ?? process.cwd(), p)
const o = cliOptions("touchline-managers-ab: A/B evaluation of the manager agents against no manager and the rule-based manager", {
  seeds: { default: "120", check: positiveInteger, help: "how many seeds (fixtures)" },
  first: { default: String(AB_FIRST_SEED), check: integer(0, 4294967295), help: "the first seed" },
  arms: { default: ARMS.join(","), help: "arms to run, comma-separated (none, rules, agent)" },
  llm: { default: "stub", check: oneOf(["stub", "openai", "external"]), help: "start the agent service on the stub or OpenAI, or use --agents-url" },
  "agents-url": { default: "http://127.0.0.1:8100/", help: "the agent service when --llm external" },
  "whatif-seeds": { default: "20", check: positiveInteger, help: "forks per tested option" },
  "whatif-horizon": { default: "600", check: positiveInteger, help: "seconds each fork plays" },
  concurrency: { default: "0", check: integer(0, 256), help: "matches at once (0: one per core but one)" },
  out: { default: join(root, "docs/evals"), help: "folder for manager-ab.md and manager-ab.json" },
  runs: { default: join(root, "out/manager-ab"), help: "folder for every decision made (decisions.jsonl)" }
})
const arms = exitOnUserError(() => {
  const list = o.arms.split(",").map((a) => a.trim())
  for (const a of list) if (!(ARMS as ReadonlyArray<string>).includes(a)) throw new CliError(`--arms: unknown arm "${a}" (none, rules, agent)`)
  return ARMS.filter((a) => list.includes(a)) as Arm[]
})

const main = async () => {
  const agents = arms.includes("agent") && o.llm !== "external" ? await startAgents(o.llm as "stub" | "openai") : null
  try {
    const whatif = { seeds: Number(o["whatif-seeds"]), horizonS: Number(o["whatif-horizon"]) }
    const results = await Effect.runPromise(runAb({
      first: Number(o.first), seeds: Number(o.seeds), arms, agentsUrl: agents?.url ?? o["agents-url"], whatif,
      ...(Number(o.concurrency) > 0 ? { concurrency: Number(o.concurrency) } : {}),
      onResult: (r, done, total) => console.log(`${done}/${total} seed ${r.seed} ${r.arm}: ${r.managed_team} ${r.score.for}-${r.score.against} ${r.opponent}, xG diff ${r.xg_diff.toFixed(2)}`)
    }))
    const model = results.flatMap((r) => r.decisions).find((d) => d.manager === "agent")?.model ?? "none"
    const summary = summarize(results, { generated: new Date().toISOString().slice(0, 10), first_seed: Number(o.first), seeds: Number(o.seeds), arms, model, whatif: { seeds: whatif.seeds, horizon_s: whatif.horizonS } })
    const out = here(o.out), runs = here(o.runs)
    mkdirSync(out, { recursive: true })
    mkdirSync(runs, { recursive: true })
    const rows = results.map(({ decisions, ...r }) => ({ ...r, decisions: decisions.length }))
    writeFileSync(join(out, "manager-ab.md"), markdown(summary))
    writeFileSync(join(out, "manager-ab.json"), JSON.stringify({ ...summary, results: rows }, null, 1) + "\n")
    writeFileSync(join(runs, "decisions.jsonl"), results.flatMap((r) => r.decisions.map((d) => JSON.stringify({ seed: r.seed, arm: r.arm, ...d }))).join("\n") + "\n")
    console.log(`wrote ${join(out, "manager-ab.md")}`)
  } finally {
    agents?.stop()
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e))
  process.exit(1)
})
