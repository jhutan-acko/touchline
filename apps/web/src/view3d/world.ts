/**
 * One 3D scene of a match (Plan 7): pitch, goals, stands and stadium light, a body per player in kit colours (gait
 * blended by speed, our kick laid on top) and the ball with its shadow. The what-if split builds two, one per play.
 * Built once, then posed every frame from a motion Sample; the cameras and the renderer live elsewhere.
 */
import * as THREE from "three"
import { clone as cloneRig } from "three/addons/utils/SkeletonUtils.js"
import type { MatchInfo } from "@touchline/rpc"
import { drawMarkings, LENGTH, WIDTH } from "../draw.js"
import { kickAt, kickPose, type Kick, type KickPart } from "./kick.js"
import { blendGaits, GAITS, gaitOf, gaitRate, turnToward, wantedYaw, type Gait, type Sample } from "./motion.js"

/** What every scene shares: the rigged body (CC0 Quaternius mannequin) and the stadium light (CC0 Poly Haven HDRI). */
export interface Assets {
  readonly body: { readonly scene: THREE.Object3D; readonly animations: ReadonlyArray<THREE.AnimationClip> }
  /** Pre-filtered for lighting (PMREM), and the backdrop; null without them (tests). */
  readonly env: THREE.Texture | null
  readonly sky: THREE.Texture | null
}

/** Keepers wear their own colours. */
export const KEEPER_KITS = { home: "#f2c14e", away: "#ff8fab" } as const
/** The layer only the tactical camera sees: a flat disc under each player, like a chalkboard. */
export const MAP_LAYER = 1
const BALL_R = 0.11

/** The pitch's surface: mown stripes and the same markings as the 2D view (draw.ts). */
export const pitchTexture = (): THREE.Texture => {
  const c = document.createElement("canvas")
  c.width = 2100
  c.height = 1360
  const ctx = c.getContext("2d")
  if (ctx) drawMarkings(ctx, { w: c.width, h: c.height }, 18)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}

/** A number on a dark rounded tag, as a texture (the jersey numbers, the markers' counts). */
export const labelTexture = (text: string, colour: string): THREE.Texture => {
  const c = document.createElement("canvas")
  c.width = 128
  c.height = 64
  const g = c.getContext("2d")
  if (g) {
    g.fillStyle = "rgba(13,20,18,.8)"
    g.beginPath()
    g.roundRect(4, 4, 120, 56, 14)
    g.fill()
    g.fillStyle = colour
    g.font = "700 40px system-ui, sans-serif"
    g.textAlign = "center"
    g.textBaseline = "middle"
    g.fillText(text, 64, 35)
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

/** A bone by its glTF name (three.js drops the dots from node names: "DEF-thigh.L" is "DEF-thighL"). */
const bone = (root: THREE.Object3D, name: string) => root.getObjectByName(name) ?? root.getObjectByName(name.replace(/\./g, ""))

interface Body {
  readonly id: string
  readonly holder: THREE.Group
  readonly model: THREE.Object3D
  readonly tag: THREE.Sprite
  readonly ring: THREE.Mesh
  readonly mixer: THREE.AnimationMixer
  readonly actions: Partial<Record<Gait, THREE.AnimationAction>>
  readonly bones: Partial<Record<KickPart, THREE.Object3D>>
  weights: Record<Gait, number>
  yaw: number
  /** The bones' poses before the kick was laid on them, to undo it before the mixer runs again. */
  saved: Partial<Record<KickPart, THREE.Quaternion>> | null
}

const X = new THREE.Vector3(1, 0, 0)

export class World {
  readonly scene = new THREE.Scene()
  readonly ball: THREE.Mesh
  private readonly shadow: THREE.Mesh
  private readonly line: THREE.Line
  private readonly bodies = new Map<string, Body>()
  private readonly kitOf: (id: string) => { kit: string; joints: string; jersey: string; foot: "left" | "right" }

  constructor(
    private readonly assets: Assets,
    match: MatchInfo
  ) {
    const s = this.scene
    if (assets.env) {
      s.environment = assets.env
      s.environmentIntensity = 0.45
    }
    if (assets.sky) {
      s.background = assets.sky
      s.backgroundBlurriness = 0.25
      s.backgroundIntensity = 0.35
    } else s.background = new THREE.Color("#0d1412")
    s.add(new THREE.HemisphereLight("#cfe3ff", "#24452d", 0.25))
    const sun = new THREE.DirectionalLight("#fff6e5", 2)
    sun.position.set(-30, 60, 25)
    sun.castShadow = true
    Object.assign(sun.shadow.camera, { left: -65, right: 65, top: 45, bottom: -45, near: 1, far: 160 })
    sun.shadow.mapSize.set(2048, 2048)
    sun.shadow.bias = -0.0005
    s.add(sun)
    const flatOn = (m: THREE.Mesh, y: number) => {
      m.rotation.x = -Math.PI / 2
      m.position.y = y
      m.receiveShadow = true
      s.add(m)
      return m
    }
    flatOn(new THREE.Mesh(new THREE.PlaneGeometry(LENGTH + 20, WIDTH + 20), new THREE.MeshStandardMaterial({ color: "#245f33", roughness: 1 })), -0.01)
    flatOn(new THREE.Mesh(new THREE.PlaneGeometry(LENGTH, WIDTH), new THREE.MeshStandardMaterial({ map: pitchTexture(), roughness: 0.95 })), 0)
    this.goals()
    this.stands()
    const home = match.home.id
    const byId = new Map(match.players.map((p) => [p.id, p]))
    this.kitOf = (id) => {
      const p = byId.get(id)
      const side = p?.team_id === home ? "home" : "away"
      const kit = p?.role === "GK" ? KEEPER_KITS[side] : side === "home" ? match.home.kit.primary : match.away.kit.primary
      return { kit, joints: side === "home" ? "#f2f2f2" : "#1d2420", jersey: p ? String(p.jersey) : "", foot: p?.foot ?? "right" }
    }
    this.ball = new THREE.Mesh(new THREE.IcosahedronGeometry(BALL_R, 2), new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.4, flatShading: true }))
    this.ball.castShadow = true
    s.add(this.ball)
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(0.22, 24), new THREE.MeshBasicMaterial({ color: "#000000", transparent: true, opacity: 0.45, depthWrite: false }))
    this.shadow.rotation.x = -Math.PI / 2
    this.shadow.position.y = 0.012
    s.add(this.shadow)
    this.line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineDashedMaterial({ color: "#f2c14e", dashSize: 0.8, gapSize: 0.5, depthTest: false }))
    this.line.renderOrder = 9
    this.line.visible = false
    s.add(this.line)
  }

  private goals() {
    const post = new THREE.MeshStandardMaterial({ color: "#ffffff" })
    const net = new THREE.LineBasicMaterial({ color: "#dfe7e3", transparent: true, opacity: 0.35 })
    for (const side of [-1, 1]) {
      const g = new THREE.Group()
      g.position.set((side * LENGTH) / 2, 0, 0)
      for (const z of [-3.66, 3.66]) {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.44), post)
        m.position.set(0, 1.22, z)
        m.castShadow = true
        g.add(m)
      }
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 7.32), post)
      bar.rotation.x = Math.PI / 2
      bar.position.set(0, 2.44, 0)
      g.add(bar)
      const box = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(2, 2.44, 7.32, 1, 4, 10)), net)
      box.position.set(side, 1.22, 0)
      g.add(box)
      this.scene.add(g)
    }
  }

  /** Low-poly stands round the pitch: no boards, no logos. */
  private stands() {
    const a = new THREE.MeshStandardMaterial({ color: "#1c2a36", roughness: 1 })
    const b = new THREE.MeshStandardMaterial({ color: "#2b3d4f", roughness: 1 })
    const stand = (w: number, x: number, z: number, ry: number) => {
      const g = new THREE.Group()
      for (let i = 0; i < 6; i++) {
        const h = 1.2 + i * 1.6
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 2.2), i % 2 ? a : b)
        m.position.set(0, h / 2, i * 2.2)
        g.add(m)
      }
      g.position.set(x, 0, z)
      g.rotation.y = ry
      this.scene.add(g)
    }
    stand(130, 0, 42, 0)
    stand(130, 0, -42, Math.PI)
    stand(90, 60, 0, Math.PI / 2)
    stand(90, -60, 0, -Math.PI / 2)
  }

  private body(id: string): Body {
    const had = this.bodies.get(id)
    if (had) return had
    const k = this.kitOf(id)
    const model = cloneRig(this.assets.body.scene as THREE.Object3D)
    model.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return
      o.castShadow = true
      o.frustumCulled = false
      const m = (o.material as THREE.MeshStandardMaterial).clone()
      if (m.name === "M_Main") m.color.set(k.kit)
      if (m.name === "M_Joints") m.color.set(k.joints)
      o.material = m
    })
    const holder = new THREE.Group()
    holder.add(model)
    const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(k.jersey, k.kit), depthTest: false, sizeAttenuation: false }))
    tag.scale.set(0.05, 0.025, 1)
    tag.position.y = 2.2
    tag.renderOrder = 10
    holder.add(tag)
    const disc = new THREE.Mesh(new THREE.CircleGeometry(1.1, 20), new THREE.MeshBasicMaterial({ color: k.kit }))
    disc.rotation.x = -Math.PI / 2
    disc.position.y = 0.05
    disc.layers.set(MAP_LAYER)
    holder.add(disc)
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.75, 32), new THREE.MeshBasicMaterial({ color: "#f2c14e", transparent: true, opacity: 0.9, depthWrite: false }))
    ring.rotation.x = -Math.PI / 2
    ring.position.y = 0.03
    ring.visible = false
    holder.add(ring)
    this.scene.add(holder)
    const mixer = new THREE.AnimationMixer(model)
    const actions: Body["actions"] = {}
    for (const g of GAITS) {
      const clip = this.assets.body.animations.find((a) => a.name === g.clip)
      if (!clip) continue
      const a = mixer.clipAction(clip)
      a.play()
      a.setEffectiveWeight(g.clip === "Idle_Loop" ? 1 : 0)
      actions[g.clip] = a
    }
    mixer.setTime((id.length * 0.37) % 2) // players out of step with each other, the same every time
    const [kick, other] = k.foot === "left" ? ["L", "R"] : ["R", "L"]
    const bones: Body["bones"] = {}
    const want: Record<KickPart, string> = { thigh: `DEF-thigh.${kick}`, shin: `DEF-shin.${kick}`, foot: `DEF-foot.${kick}`, support: `DEF-thigh.${other}`, spine: "DEF-spine.001" }
    for (const part of Object.keys(want) as KickPart[]) {
      const b = bone(model, want[part])
      if (b) bones[part] = b
    }
    const b: Body = { id, holder, model, tag, ring, mixer, actions, bones, weights: { Idle_Loop: 1, Walk_Loop: 0, Jog_Fwd_Loop: 0, Sprint_Loop: 0 }, yaw: 0, saved: null }
    this.bodies.set(id, b)
    return b
  }

  /** Pose the scene at a sample: `dt` is the animation time step (0 while paused), `fps` the match's frame rate. */
  update(s: Sample, kicks: ReadonlyArray<Kick>, fps: number, dt: number): void {
    this.ball.position.set(s.ball.x, s.ball.z + BALL_R, -s.ball.y)
    this.ball.rotation.x += dt * 8
    this.shadow.position.set(s.ball.x, 0.012, -s.ball.y)
    this.shadow.scale.setScalar(1 + s.ball.z * 0.25)
    ;(this.shadow.material as THREE.MeshBasicMaterial).opacity = Math.max(0.12, 0.45 - s.ball.z * 0.06)
    for (const b of this.bodies.values()) b.holder.visible = s.players.has(b.id)
    for (const [id, p] of s.players) {
      const b = this.body(id)
      b.holder.position.set(p.x, 0, -p.y)
      const k = kickAt(kicks, id, s.frame, fps)
      // Square up to the pass while kicking, else face the way they run (or the ball).
      const want = k ? k.kick.yaw : wantedYaw(p, s.ball)
      if (want !== null) b.yaw = turnToward(b.yaw, want, dt || 1 / 60, k ? 14 : 8)
      b.holder.rotation.y = b.yaw
      const speed = Math.hypot(p.vx, p.vy)
      b.weights = blendGaits(b.weights, k ? "Idle_Loop" : gaitOf(speed), dt)
      for (const g of GAITS) {
        const a = b.actions[g.clip]
        if (!a) continue
        a.setEffectiveWeight(b.weights[g.clip])
        a.timeScale = gaitRate(g.clip, speed)
      }
      // Undo last frame's kick, let the mixer pose the body, then lay this frame's kick on top.
      if (b.saved) {
        for (const part of Object.keys(b.saved) as KickPart[]) b.bones[part]!.quaternion.copy(b.saved[part]!)
        b.saved = null
      }
      b.mixer.update(dt)
      if (k) {
        const pose = kickPose(k.t)
        b.saved = {}
        for (const part of Object.keys(pose) as KickPart[]) {
          const bn = b.bones[part]
          if (!bn) continue
          b.saved[part] = bn.quaternion.clone()
          bn.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(X, pose[part]))
        }
      }
    }
  }

  /** Where a player stands (world), or null when not on the pitch. */
  positionOf(id: string): THREE.Vector3 | null {
    const b = this.bodies.get(id)
    return b && b.holder.visible ? b.holder.position : null
  }

  /** The ids of the players on the pitch. */
  get onPitch(): string[] {
    return [...this.bodies.values()].filter((b) => b.holder.visible).map((b) => b.id)
  }

  /** Mark the followed player (a ring at their feet), hide one body (the first-person view's own), show or hide the numbers. */
  dress(o: { readonly followed: string | null; readonly hidden: string | null; readonly tags: boolean }): void {
    for (const b of this.bodies.values()) {
      b.ring.visible = b.id === o.followed && b.id !== o.hidden
      b.model.visible = b.id !== o.hidden
      b.tag.visible = o.tags && b.id !== o.hidden
    }
  }

  /** A dashed pass line on the grass between two players, or none. */
  passLine(from: string | null, to: string | null, colour = "#f2c14e"): void {
    const a = from ? this.positionOf(from) : null
    const b = to ? this.positionOf(to) : null
    this.line.visible = a !== null && b !== null
    if (!a || !b) return
    ;(this.line.material as THREE.LineDashedMaterial).color.set(colour)
    this.line.geometry.setFromPoints([a.clone().setY(0.1), b.clone().setY(0.1)])
    this.line.computeLineDistances()
  }

  /** The kick overlay's bones of a player (tests). */
  bonesOf(id: string): Partial<Record<KickPart, THREE.Object3D>> {
    return this.bodies.get(id)?.bones ?? {}
  }

  /** Free this scene's GPU objects (the bodies' geometry belongs to the shared assets and stays). */
  dispose(): void {
    const shared = new Set<THREE.BufferGeometry>()
    for (const b of this.bodies.values()) b.model.traverse((o) => o instanceof THREE.Mesh && shared.add(o.geometry))
    this.scene.traverse((o) => {
      if (!(o instanceof THREE.Mesh || o instanceof THREE.Line || o instanceof THREE.Sprite)) return
      if (!shared.has(o.geometry)) o.geometry.dispose()
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        ;(m as THREE.MeshStandardMaterial).map?.dispose()
        m.dispose()
      }
    })
  }
}
