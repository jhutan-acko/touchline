/**
 * Drawing several cameras on one WebGL canvas (Plan 7): each viewport gets its own camera and its own post-processing
 * chain (MSAA, ambient occlusion, a little bloom, ACES tone mapping), scissored to its rectangle. Also answers which
 * player is under a click.
 */
import * as THREE from "three"
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js"
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js"
import { OutputPass } from "three/addons/postprocessing/OutputPass.js"
import { RenderPass } from "three/addons/postprocessing/RenderPass.js"
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js"
import { poseCamera, type Rig, type Shot } from "./cameras.js"
import { nearestOnScreen, viewportAt, type Viewport } from "./layout.js"
import type { Sample } from "./motion.js"
import { MAP_LAYER, type World } from "./world.js"

/** Set once on the renderer: ACES (applied by each chain's output pass), exposure tuned for the stadium light. */
export const setUpRenderer = (gl: THREE.WebGLRenderer): void => {
  gl.toneMapping = THREE.ACESFilmicToneMapping
  gl.toneMappingExposure = 0.85
  gl.outputColorSpace = THREE.SRGBColorSpace
  gl.shadowMap.enabled = true
  gl.shadowMap.type = THREE.PCFShadowMap // r186 removed the soft variant
  gl.setScissorTest(true)
}

interface View {
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera
  rig: Rig | null
  composer: EffectComposer | null
  scene: THREE.Scene | null
  w: number
  h: number
}

export interface Frame3D {
  readonly worlds: Readonly<Partial<Record<Viewport["world"], World>>>
  readonly samples: Readonly<Partial<Record<Viewport["world"], Sample | null>>>
  readonly followed: string | null
  /** Seconds since the last frame (cameras ease by it), and the clock for the first-person head-bob. */
  readonly dt: number
  readonly time: number
}

export class MultiView {
  private readonly views = new Map<string, View>()
  private last: ReadonlyArray<Viewport> = []

  constructor(private readonly gl: THREE.WebGLRenderer) {}

  private view(v: Viewport): View {
    let x = this.views.get(v.key)
    const ortho = v.camera === "tactical"
    if (!x || (x.camera instanceof THREE.OrthographicCamera) !== ortho) {
      x?.composer?.dispose()
      const camera = ortho ? new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 300) : new THREE.PerspectiveCamera(50, 1, 0.05, 400)
      if (ortho) camera.layers.enable(MAP_LAYER)
      x = { camera, rig: null, composer: null, scene: null, w: 0, h: 0 }
      this.views.set(v.key, x)
    }
    return x
  }

  private aim(view: View, shot: Shot, aspect: number) {
    const c = view.camera
    if (shot.kind === "ortho" && c instanceof THREE.OrthographicCamera) {
      Object.assign(c, { left: -shot.halfW, right: shot.halfW, top: shot.halfH, bottom: -shot.halfH })
      c.up.set(0, 0, -1)
    } else if (shot.kind === "perspective" && c instanceof THREE.PerspectiveCamera) {
      c.fov = shot.fov
      c.aspect = aspect
      c.up.set(0, 1, 0)
    }
    c.position.set(...shot.pos)
    c.lookAt(...shot.look)
    c.updateProjectionMatrix()
  }

  private chain(view: View, scene: THREE.Scene, v: Viewport): EffectComposer {
    const w = Math.max(1, Math.round(v.w))
    const h = Math.max(1, Math.round(v.h))
    if (!view.composer || view.scene !== scene) {
      view.composer?.dispose()
      const target = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 4 })
      const c = new EffectComposer(this.gl, target)
      c.addPass(new RenderPass(scene, view.camera))
      if (v.camera !== "tactical") {
        const ao = new GTAOPass(scene, view.camera, w, h)
        ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1.5, scale: 1 })
        ao.blendIntensity = 0.85
        c.addPass(ao)
      }
      c.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), 0.22, 0.35, 0.92))
      c.addPass(new OutputPass())
      Object.assign(view, { composer: c, scene, w: 0, h: 0 })
    }
    if (view.w !== w || view.h !== h) {
      view.composer!.setPixelRatio(this.gl.getPixelRatio())
      view.composer!.setSize(w, h)
      Object.assign(view, { w, h })
    }
    return view.composer!
  }

  /** Draw every viewport (CSS pixels from the canvas's top left). */
  render(vps: ReadonlyArray<Viewport>, f: Frame3D): void {
    const height = this.gl.domElement.clientHeight
    for (const v of vps) {
      const world = f.worlds[v.world]
      const sample = f.samples[v.world]
      if (!world || !sample) continue
      const view = this.view(v)
      const player = f.followed ? (sample.players.get(f.followed) ?? null) : null
      const camera = (v.camera === "follow" || v.camera === "fp") && !player ? "broadcast" : v.camera
      const { shot, rig } = poseCamera(camera, view.rig, { player, ball: sample.ball }, f.dt, v.w / v.h, f.time)
      view.rig = rig
      this.aim(view, shot, v.w / v.h)
      world.dress({ followed: f.followed, hidden: camera === "fp" ? f.followed : null, tags: camera !== "tactical" })
      this.gl.setViewport(v.x, height - v.y - v.h, v.w, v.h)
      this.gl.setScissor(v.x, height - v.y - v.h, v.w, v.h)
      this.chain(view, world.scene, v).render(f.dt)
    }
    for (const w of Object.values(f.worlds)) w?.dress({ followed: f.followed, hidden: null, tags: true })
    // Views no longer on screen give back their GPU memory.
    for (const [key, view] of this.views) {
      if (vps.some((v) => v.key === key)) continue
      view.composer?.dispose()
      this.views.delete(key)
    }
    this.last = vps
  }

  /** The player under a click (CSS pixels from the canvas's top left), in the viewport clicked. */
  pick(x: number, y: number, worlds: Frame3D["worlds"]): string | null {
    const v = viewportAt(this.last, x, y)
    const view = v && this.views.get(v.key)
    const world = v && worlds[v.world]
    if (!v || !view || !world) return null
    const points = world.onPitch.flatMap((id) => {
      const p = world.positionOf(id)!.clone().setY(1).project(view.camera)
      return p.z > 1 ? [] : [{ id, sx: v.x + ((p.x + 1) / 2) * v.w, sy: v.y + ((1 - p.y) / 2) * v.h }]
    })
    return nearestOnScreen(points, x, y)
  }

  dispose(): void {
    for (const v of this.views.values()) v.composer?.dispose()
    this.views.clear()
  }
}
