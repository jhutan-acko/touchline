import { describe, expect, it } from "vitest"
import { BROADCAST_FOV, EYE_M, FP_MAX_TURN, poseCamera, steer, type Scene } from "../src/view3d/cameras.js"
import { nearestOnScreen, NARROW_PX, viewportAt, viewports } from "../src/view3d/layout.js"

const runner = (x: number, y: number, vx = 0, vy = 0) => ({ x, y, vx, vy })
const scene = (player: Scene["player"], ball: [number, number, number] = [0, 0, 0]): Scene => ({ player, ball: { x: ball[0], y: ball[1], z: ball[2] } })
const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!)

describe("follow camera", () => {
  it("sits behind and above the player, looking ahead of them toward the ball", () => {
    const { shot } = poseCamera("follow", null, scene(runner(0, 0, 0, 0), [10, 0, 0]), 0.016, 16 / 9)
    if (shot.kind !== "perspective") throw new Error("perspective")
    expect(shot.pos[0]).toBeLessThan(-7) // behind: the ball is ahead along +x
    expect(shot.pos[1]).toBeGreaterThan(3)
    expect(shot.look[0]).toBeGreaterThan(0)
  })

  it("pulls back when the ball is far, so both stay in frame", () => {
    const near = poseCamera("follow", null, scene(runner(0, 0), [5, 0, 0]), 0.016, 1).shot
    const far = poseCamera("follow", null, scene(runner(0, 0), [40, 0, 0]), 0.016, 1).shot
    expect(dist(far.pos, [0, 0, 0])).toBeGreaterThan(dist(near.pos, [0, 0, 0]) + 5)
  })

  it("moves smoothly from its last pose instead of jumping", () => {
    const a = poseCamera("follow", null, scene(runner(0, 0), [10, 0, 0]), 0.016, 1)
    const b = poseCamera("follow", a.rig, scene(runner(20, 0), [30, 0, 0]), 0.016, 1)
    const settled = poseCamera("follow", null, scene(runner(20, 0), [30, 0, 0]), 0.016, 1)
    expect(dist(b.shot.pos, a.shot.pos)).toBeLessThan(dist(settled.shot.pos, a.shot.pos) / 5)
  })
})

describe("first-person camera", () => {
  it("is at eye height and looks the way the player looks, never turning faster than the cap", () => {
    const a = poseCamera("fp", null, scene(runner(0, 0, 4, 0), [10, 0, 0]), 0.016, 1)
    expect(a.shot.pos[1]).toBeCloseTo(EYE_M, 1)
    expect(a.rig.dir[0]).toBeCloseTo(1) // running at the ball along +x
    // The ball jumps behind them: one frame turns at most FP_MAX_TURN × dt.
    const b = poseCamera("fp", a.rig, scene(runner(0, 0), [-10, 0, 0]), 0.1, 1)
    const turned = Math.acos(Math.max(-1, Math.min(1, b.rig.dir[0] * a.rig.dir[0] + b.rig.dir[2] * a.rig.dir[2])))
    expect(turned).toBeLessThanOrEqual(FP_MAX_TURN * 0.1 + 1e-9)
    expect(turned).toBeGreaterThan(0)
  })

  it("needs a player", () => {
    expect(() => poseCamera("fp", null, scene(null), 0.016, 1)).toThrow(/needs a player/)
  })
})

describe("broadcast and tactical cameras", () => {
  it("broadcast: high in the main stand, panning with the ball, damped", () => {
    const a = poseCamera("broadcast", null, scene(null, [30, 0, 0]), 0.016, 1)
    expect(a.shot).toMatchObject({ kind: "perspective", fov: BROADCAST_FOV })
    expect(a.shot.pos[1]).toBeGreaterThan(20)
    expect(a.shot.pos[0]).toBeGreaterThan(10)
    const b = poseCamera("broadcast", a.rig, scene(null, [-30, 0, 0]), 0.016, 1)
    expect(b.shot.pos[0]).toBeGreaterThan(10) // still mostly where it was
  })

  it("tactical: top-down over the whole pitch, whatever the shape", () => {
    for (const aspect of [16 / 9, 0.6, 3]) {
      const { shot } = poseCamera("tactical", null, scene(null), 0.016, aspect)
      if (shot.kind !== "ortho") throw new Error("ortho")
      expect(shot.halfW).toBeGreaterThanOrEqual(52.5)
      expect(shot.halfH).toBeGreaterThanOrEqual(34)
      expect(shot.halfW / shot.halfH).toBeCloseTo(aspect)
    }
  })

  it("steering eases and caps the turn", () => {
    const d = steer([1, 0, 0], [0, 0, 1], 0.1, 100, 1)
    expect(Math.atan2(d[0], d[2])).toBeCloseTo(Math.PI / 2 - 0.1)
  })
})

describe("layout", () => {
  it("main + map: the camera fills the canvas with the tactical map inset in a corner", () => {
    const [main, map] = viewports({ mode: "multi", layout: "pip", camera: "follow", w: 1200, h: 700 })
    expect(main).toMatchObject({ x: 0, y: 0, w: 1200, h: 700, camera: "follow", world: "real", inset: false })
    expect(map).toMatchObject({ camera: "tactical", inset: true })
    expect(map!.x + map!.w).toBeLessThan(1200)
    expect(map!.w / map!.h).toBeCloseTo(105 / 68)
    expect(viewports({ mode: "multi", layout: "pip", camera: "tactical", w: 1200, h: 700 })).toHaveLength(1)
  })

  it("grid: all four cameras in quarters; narrow screens get one view", () => {
    const g = viewports({ mode: "multi", layout: "grid", camera: "follow", w: 1000, h: 600 })
    expect(g.map((v) => v.camera)).toEqual(["follow", "fp", "broadcast", "tactical"])
    expect(g.map((v) => [v.x, v.y])).toEqual([[0, 0], [500, 0], [0, 300], [500, 300]])
    for (const layout of ["grid", "pip"] as const) expect(viewports({ mode: "multi", layout, camera: "fp", w: NARROW_PX - 1, h: 600 }).map((v) => v.camera)).toEqual(["fp"])
  })

  it("split: real and variant side by side, stacked when narrow, both with the chosen camera", () => {
    const wide = viewports({ mode: "split", layout: "grid", camera: "broadcast", w: 1000, h: 500 })
    expect(wide.map((v) => [v.world, v.camera, v.x, v.w])).toEqual([["real", "broadcast", 0, 500], ["variant", "broadcast", 500, 500]])
    const tall = viewports({ mode: "split", layout: "pip", camera: "follow", w: 400, h: 800 })
    expect(tall.map((v) => [v.world, v.y, v.h])).toEqual([["real", 0, 400], ["variant", 400, 400]])
  })

  it("finds the viewport under a click (the inset on top) and the nearest player within reach", () => {
    const vps = viewports({ mode: "multi", layout: "pip", camera: "follow", w: 1200, h: 700 })
    expect(viewportAt(vps, 1150, 650)!.key).toBe("map")
    expect(viewportAt(vps, 10, 10)!.key).toBe("main-follow")
    expect(viewportAt(vps, 5000, 10)).toBeNull()
    const pts = [{ id: "a", sx: 100, sy: 100 }, { id: "b", sx: 130, sy: 100 }]
    expect(nearestOnScreen(pts, 125, 100)).toBe("b")
    expect(nearestOnScreen(pts, 400, 400)).toBeNull()
  })
})
