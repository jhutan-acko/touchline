/**
 * Whether this browser can draw the 3D view (WebGL 2); without it the Watch page stays on the 2D pitch. Probed once per
 * page, and the probe's context is given back at once: browsers keep only a few WebGL contexts alive.
 */
let answer: boolean | null = null

export const hasWebGL = (): boolean => {
  if (answer !== null) return answer
  try {
    const gl = typeof document !== "undefined" ? document.createElement("canvas").getContext("webgl2") : null
    gl?.getExtension("WEBGL_lose_context")?.loseContext()
    answer = gl !== null
  } catch {
    answer = false
  }
  return answer
}
