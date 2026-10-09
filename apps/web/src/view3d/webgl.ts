/** Whether this browser can draw the 3D view (WebGL 2); without it the Watch page stays on the 2D pitch. */
export const hasWebGL = (): boolean => {
  try {
    return typeof document !== "undefined" && document.createElement("canvas").getContext("webgl2") !== null
  } catch {
    return false
  }
}
