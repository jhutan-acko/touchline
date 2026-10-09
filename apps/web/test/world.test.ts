import * as THREE from "three"
import { describe, expect, it } from "vitest"
import type { PitchFrame } from "@touchline/rpc"
import { findKicks, KICK_S } from "../src/view3d/kick.js"
import { sampleClip } from "../src/view3d/motion.js"
import { KEEPER_KITS, MAP_LAYER, World, type Assets } from "../src/view3d/world.js"
import { INFO } from "./fake-client.js"

/** A stand-in for the rigged body: the named materials and the kick's bones (three.js drops the dots), no animation tracks. */
const assets = (): Assets => {
  const root = new THREE.Group()
  for (const name of ["M_Main", "M_Joints"]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.8, 0.3), new THREE.MeshStandardMaterial({ name }))
    root.add(m)
  }
  for (const name of ["DEF-thighL", "DEF-shinL", "DEF-footL", "DEF-thighR", "DEF-shinR", "DEF-footR", "DEF-spine001"]) {
    const b = new THREE.Bone()
    b.name = name
    root.add(b)
  }
  const animations = ["Idle_Loop", "Walk_Loop", "Jog_Fwd_Loop", "Sprint_Loop"].map((n) => new THREE.AnimationClip(n, 1, []))
  return { body: { scene: root, animations }, env: null, sky: null }
}

const keeper = INFO.players[0]! // home keeper, right foot
const striker = INFO.players[1]! // away striker, left foot
const frame = (n: number, k: [number, number], s: [number, number], ball: [number, number, number]): PitchFrame => ({
  frame: n, period: "first_half", clock: "00:00.00", ball: { x: ball[0], y: ball[1], z: ball[2] }, home: [{ id: keeper.id, x: k[0], y: k[1] }], away: [{ id: striker.id, x: s[0], y: s[1] }]
})
const colour = (w: World, id: string, material: string) => {
  let c = ""
  w.scene.traverse((o) => {
    if (o instanceof THREE.Mesh && (o.material as THREE.MeshStandardMaterial).name === material && o.parent?.parent?.position.equals(w.positionOf(id) ?? new THREE.Vector3(1e9, 0, 0))) c = `#${(o.material as THREE.MeshStandardMaterial).color.getHexString()}`
  })
  return c
}

describe("3D world", () => {
  it("puts a body per player on the pitch in kit colours (keepers in their own), and the ball at its height", () => {
    const w = new World(assets(), INFO)
    const f = frame(0, [-50, 0], [10, -5], [3, 4, 2])
    w.update(sampleClip([f], 0, 10)!, [], 10, 0)
    expect(w.onPitch.sort()).toEqual([keeper.id, striker.id].sort())
    expect(w.positionOf(striker.id)!.toArray()).toEqual([10, 0, 5])
    expect(colour(w, keeper.id, "M_Main")).toBe(KEEPER_KITS.home)
    expect(colour(w, striker.id, "M_Main")).toBe(INFO.away.kit.primary)
    expect(w.ball.position.x).toBe(3)
    expect(w.ball.position.z).toBe(-4)
    expect(w.ball.position.y).toBeGreaterThan(2)
  })

  it("draws the chalkboard discs only for the tactical map", () => {
    const w = new World(assets(), INFO)
    w.update(sampleClip([frame(0, [0, 0], [5, 0], [0, 0, 0])], 0, 10)!, [], 10, 0)
    const discs: THREE.Object3D[] = []
    w.scene.traverse((o) => o.layers.mask === 1 << MAP_LAYER && discs.push(o))
    expect(discs).toHaveLength(2)
  })

  it("turns a runner toward where they run, and hides players who left the pitch", () => {
    const w = new World(assets(), INFO)
    const clip = [frame(0, [0, 0], [0, 10], [20, 20, 0]), frame(1, [0.5, 0], [0, 10], [20, 20, 0])]
    for (let i = 0; i < 60; i++) w.update(sampleClip(clip, 0.5, 10)!, [], 10, 1 / 60)
    const body = w.positionOf(keeper.id)!
    expect(body).not.toBeNull()
    let yaw = 0
    w.scene.traverse((o) => o.position === body && (yaw = o.rotation.y))
    expect(yaw).toBeCloseTo(Math.PI / 2, 1) // running along +x
    w.update(sampleClip([{ ...clip[1]!, away: [] }], 0, 10)!, [], 10, 1 / 60)
    expect(w.positionOf(striker.id)).toBeNull()
    expect(w.onPitch).toEqual([keeper.id])
  })

  it("lays the kick on the preferred leg and takes it off again, never building up across frames", () => {
    const w = new World(assets(), INFO)
    // The striker (left foot) plays the ball away fast along +x.
    const clip = Array.from({ length: 16 }, (_, n) => frame(n, [-50, 0], [0, 0.5], [n > 8 ? 0.3 + (n - 8) * 1.5 : -2.4 + n * 0.3, 0, 0]))
    const kicks = findKicks(clip, 10)
    expect(kicks.map((k) => k.player_id)).toEqual([striker.id])
    w.update(sampleClip(clip, 0, 10)!, kicks, 10, 0)
    const left = w.bonesOf(striker.id)
    expect(left.thigh!.name).toBe("DEF-thighL")
    const strike = kicks[0]!.start + 0.65 * KICK_S * 10
    w.update(sampleClip(clip, strike, 10)!, kicks, 10, 0.016)
    const mid = left.thigh!.quaternion.clone()
    expect(mid.angleTo(new THREE.Quaternion())).toBeGreaterThan(1)
    w.update(sampleClip(clip, strike, 10)!, kicks, 10, 0.016)
    expect(left.thigh!.quaternion.angleTo(mid)).toBeCloseTo(0) // the same pose again, not twice the kick
    w.update(sampleClip(clip, 15, 10)!, kicks, 10, 0.016)
    expect(left.thigh!.quaternion.angleTo(new THREE.Quaternion())).toBeCloseTo(0)
    expect(left.support!.name).toBe("DEF-thighR")
  })

  it("marks the followed player, hides the first-person body, draws a pass line, and frees its own objects only", () => {
    const shared = assets()
    const a = new World(shared, INFO)
    const b = new World(shared, INFO)
    for (const w of [a, b]) w.update(sampleClip([frame(0, [0, 0], [5, 0], [0, 0, 0])], 0, 10)!, [], 10, 0)
    a.dress({ followed: striker.id, hidden: keeper.id, tags: false })
    a.passLine(keeper.id, striker.id, "#5fd38d")
    let line: THREE.Line | undefined
    a.scene.traverse((o) => o instanceof THREE.Line && (o.material as THREE.LineDashedMaterial).dashSize && (line = o))
    expect(line!.visible).toBe(true)
    a.passLine(keeper.id, "nobody")
    expect(line!.visible).toBe(false)
    let disposed = 0
    ;(shared.body.scene.children[0] as THREE.Mesh).geometry.addEventListener("dispose", () => disposed++)
    a.dispose()
    expect(disposed).toBe(0)
  })
})
