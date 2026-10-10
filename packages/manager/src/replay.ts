/**
 * Replaying a managed match from its decision log (spec §2.4): the logged orders are applied at their ticks, so the
 * match is bit-identical to the original and makes no model calls. Every replayed moment must see exactly the
 * situation the original decision saw (same hash); anything else means the engine or the log changed.
 */
import { Effect } from "effect"
import type { Decision } from "@touchline/schema"
import type { DecideInput, Manager } from "./decision.js"

/** The decision log does not fit the match being replayed. */
export class ReplayMismatch extends Error {}

/** A manager that answers each key moment with the logged decision for that tick and team. */
export const replayManager = (decisions: ReadonlyArray<Decision>): Manager => ({
  kind: "replay",
  decide: (input: DecideInput) =>
    Effect.sync(() => {
      const d = decisions.find((x) => x.tick === input.state.tick && x.side === input.side)
      if (!d) throw new ReplayMismatch(`no logged decision for ${input.side} at tick ${input.state.tick}`)
      if (d.situation_hash !== input.situationHash) throw new ReplayMismatch(`the situation at tick ${d.tick} (${d.side}) differs from the logged one`)
      return d
    })
})
