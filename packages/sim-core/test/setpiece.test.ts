import { describe, expect, it } from "vitest"
import { DEFAULT_PARAMS } from "../src/params.js"
import { deadKey, framePoint, roleSpot, setPieceKind, ySignOf } from "../src/setpiece.js"
import { initMatch, step } from "../src/step.js"
import { makeConfig } from "../src/testing.js"
import type { MatchState } from "../src/types.js"

describe("setpiece.ts", () => {
  it("classifies restarts in the taking side's frame, mirrored after half-time", () => {
    const h1 = (restart: Parameters<typeof setPieceKind>[0], x: number, y: number) => setPieceKind(restart, { x, y }, "home", "first_half")
    expect(h1("corner", 52.5, 34)).toBe("corner")
    expect(h1("free_kick", 30, 25)).toBe("fk_wide")
    expect(h1("free_kick", 30, 5)).toBe("fk_central")
    expect(h1("free_kick", 10, 5)).toBe("fk_other")
    expect(h1("throw_in", -30, 34)).toBe("throw_def")
    expect(h1("throw_in", 0, 34)).toBe("throw_mid")
    expect(h1("throw_in", 30, -34)).toBe("throw_att")
    expect(h1("goal_kick", -47, 0)).toBe("goal_kick")
    expect(h1("kickoff", 0, 0)).toBe("kickoff")
    expect(h1("penalty", 41.5, 0)).toBe("penalty")
    expect(setPieceKind("free_kick", { x: -30, y: 5 }, "home", "second_half")).toBe("fk_central")
    expect(setPieceKind("free_kick", { x: 30, y: 5 }, "home", "second_half")).toBe("fk_other")
    expect(setPieceKind("throw_in", { x: -30, y: 34 }, "away", "first_half")).toBe("throw_att")
    expect(deadKey("fk_central")).toBe("free_kick_att")
    expect(deadKey("fk_wide")).toBe("free_kick_att")
    expect(deadKey("fk_other")).toBe("free_kick")
    expect(deadKey("throw_mid")).toBe("throw_in")
    expect(deadKey("corner")).toBe("corner")
    expect(deadKey("penalty")).toBeNull()
  })
  it("role spots: table u and |y| in the restarting frame, the player's own sign", () => {
    const corner = DEFAULT_PARAMS.setAttack.corner
    expect(roleSpot(corner, "CB", -1, "home", "first_half")).toEqual({ x: 42, y: -4 })
    expect(roleSpot(corner, "CB", -1, "home", "second_half")).toEqual({ x: -42, y: -4 })
    expect(roleSpot(corner, "CB", 1, "away", "first_half")).toEqual({ x: -42, y: 4 })
    expect(roleSpot(corner, "DM", 1, "home", "first_half")).toEqual(roleSpot(corner, "CM", 1, "home", "first_half"))
    expect(roleSpot(corner, "ST", 0, "home", "first_half")).toEqual({ x: 43, y: 0 })
    expect(roleSpot(corner, "GK", -1, "home", "first_half")).toEqual({ x: -12, y: 0 })
    expect(ySignOf({ x: 3, y: -0.0 })).toBe(0)
    expect(ySignOf({ x: 3, y: 2 })).toBe(1)
    expect(ySignOf({ x: 3, y: -2 })).toBe(-1)
    // Set-piece frame (F11): u along the attack, y the pitch y (only x mirrors).
    expect(framePoint("home", "first_half", 47, -5.5)).toEqual({ x: 47, y: -5.5 })
    expect(framePoint("home", "second_half", 47, -5.5)).toEqual({ x: -47, y: -5.5 })
    expect(framePoint("away", "first_half", 0, 0)).toEqual({ x: 0, y: 0 })
    expect(Object.is(framePoint("away", "first_half", 0, -0).y, 0)).toBe(true)
    // A NaN in a table shows through (it is not turned into 0).
    expect(framePoint("home", "first_half", Number.NaN, 4).x).toBeNaN()
  })
})

describe("P5 restart state", () => {
  // A first-half free kick being set up (its resume tick far off), with a plan and a live set piece in the state.
  const pending = (periodTick: number): MatchState => {
    const s = initMatch(makeConfig(7))
    return {
      ...s,
      tick: periodTick,
      periodTick,
      phase: { kind: "restart", restart: "free_kick", side: "home", at: { x: 30, y: 5 }, resumeTick: periodTick + 1000 },
      possession: { kind: "dead" },
      restartPlan: { kind: "fk_central", wall: [s.players[15]!.id, s.players[16]!.id] },
      setPiece: { kind: "corner", side: "home", tick: periodTick - 50, takerId: s.players[9]!.id }
    }
  }
  it("carries the restart plan and the live set piece from step to step", () => {
    const s = pending(100)
    const next = step(s).state
    expect(next.phase.kind).toBe("restart")
    expect(next.restartPlan).toEqual(s.restartPlan)
    expect(next.setPiece).toEqual(s.setPiece)
  })
  it("a half cut by the hard stop with a restart pending leaves no plan or set piece for the kickoff", () => {
    const base = pending(0)
    // The hard stop: a minute past the half's length (10 Hz), the restart still pending.
    const s = pending(base.periodTicks + 600)
    const r = step(s)
    expect(r.events.some((e) => e.type === "period_end")).toBe(true)
    expect(r.state.period).toBe("second_half")
    expect(r.state.restartPlan).toBeUndefined()
    expect(r.state.setPiece).toBeUndefined()
  })
})
