/** Plays one A/B match off the main thread (ab/cli.ts). */
import { parentPort, workerData } from "node:worker_threads"
import { Effect } from "effect"
import { a2aSender } from "@touchline/agent-gateway"
import { agentManager } from "../agent.js"
import { playArm, type Arm, type Fixture } from "./match.js"
import { loadSetup } from "./setup.js"

export interface AbJob {
  readonly fixture: Fixture
  readonly arm: Arm
  readonly agentsUrl: string
  readonly whatif: { readonly seeds: number; readonly horizonS: number }
}

const job = workerData as AbJob
const setup = loadSetup()
Effect.runPromise(playArm(setup.config(job.fixture), job.fixture, job.arm, () => agentManager(a2aSender(job.agentsUrl), { whatif: job.whatif }), setup.stats)).then(
  (ok) => parentPort!.postMessage({ ok }),
  (e) => parentPort!.postMessage({ error: e instanceof Error ? e.message : String(e) })
)
