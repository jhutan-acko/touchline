/** Loading the 3D view's assets (public/3d, CC0; see ATTRIBUTION.md): the rigged body once, the stadium light per renderer. */
import * as THREE from "three"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"
import { HDRLoader } from "three/addons/loaders/HDRLoader.js"
import type { Assets } from "./world.js"

export const BODY_URL = "/3d/player.glb"
export const SKY_URL = "/3d/stadium_01_1k.hdr"

let body: Promise<Assets["body"]> | null = null
let sky: Promise<THREE.DataTexture> | null = null

/** The body and the stadium light, the light pre-filtered for this renderer's materials. */
export const loadAssets = async (gl: THREE.WebGLRenderer): Promise<Assets> => {
  body ??= new GLTFLoader().loadAsync(BODY_URL).then((g) => ({ scene: g.scene, animations: g.animations }))
  sky ??= new HDRLoader().loadAsync(SKY_URL).then((t) => {
    t.mapping = THREE.EquirectangularReflectionMapping
    return t
  })
  const [b, s] = await Promise.all([body, sky])
  const pmrem = new THREE.PMREMGenerator(gl)
  const env = pmrem.fromEquirectangular(s).texture
  pmrem.dispose()
  return { body: b, env, sky: s }
}
