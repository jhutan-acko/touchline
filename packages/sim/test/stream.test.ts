import { describe, expect, it } from "@effect/vitest"
import { createHash } from "node:crypto"
import { Effect, Fiber, Stream } from "effect"
import { TestClock } from "effect/testing"
import { collect, matchSteps, pacedSteps } from "../src/run.js"
import { makeConfig } from "@touchline/sim-core/testing"

const hash = (x: unknown) => createHash("sha256").update(JSON.stringify(x)).digest("hex")

describe("match stream", () => {
  it.effect("paced and unpaced runs produce identical output", () =>
    Effect.gen(function* () {
      const cfg = makeConfig(3)
      const unpaced = yield* collect(matchSteps(cfg).pipe(Stream.take(1200)))
      const fiber = yield* Effect.forkChild(collect(pacedSteps(cfg, 4).pipe(Stream.take(1200))))
      yield* TestClock.adjust("40 seconds")
      const paced = yield* Fiber.join(fiber)
      expect(paced.length).toBe(1200)
      expect(hash(paced.map((r) => [r.frame, r.events]))).toBe(hash(unpaced.map((r) => [r.frame, r.events])))
    }))
  it.effect("ends at full time", () =>
    Effect.gen(function* () {
      const all = yield* collect(matchSteps(makeConfig(4)))
      expect(all.at(-1)!.events.at(-1)!.type).toBe("match_end")
      expect(all.at(-1)!.frame).toBeNull()
    }))
})
