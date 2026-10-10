/**
 * Writing a managed match (spec §2.4): the run folder of a plain match (CDF, domain events, manifest) plus
 * decisions.jsonl, one line per decision, and the managers in the manifest; reading a decision log back for replay.
 */
import { readFileSync } from "node:fs"
import { Effect } from "effect"
import type { MatchConfig } from "@touchline/sim-core"
import { writeMatch } from "@touchline/sim"
import { decodeDecision, type Decision } from "@touchline/schema"
import type { StatsModels, XtGrid } from "@touchline/stats"
import { managedConfig, managedSteps, type Managers } from "./run.js"

export const DECISIONS_FILE = "decisions.jsonl"

/** Simulate a managed match into `dir`; the manifest it wrote. */
export const writeManaged = (cfg: MatchConfig, managers: Managers, dir: string, stats: { readonly models: StatsModels; readonly xt: XtGrid | null }) =>
  Effect.suspend(() => {
    const decisions: Decision[] = []
    const steps = managedSteps(cfg, managers, { ...stats, onDecision: (d) => decisions.push(d) })
    return writeMatch(managedConfig(cfg, managers), dir, {
      // Each line in the contract's canonical form (and checked), so a replay writes the same bytes.
      managed: { steps, managers: { home: managers.home?.kind ?? null, away: managers.away?.kind ?? null }, decisions: () => decisions.map((d) => decodeDecision(d)) }
    })
  })

/** A run folder's decision log, each line checked against the Decision contract. */
export const readDecisions = (file: string): Decision[] =>
  readFileSync(file, "utf8").split("\n").filter((l) => l.trim()).map((l) => decodeDecision(JSON.parse(l)))
