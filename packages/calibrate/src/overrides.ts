import { CliError } from "@touchline/sim"
import { DEFAULT_PARAMS } from "@touchline/sim-core"

/** Throws unless every key of `path` exists in the default parameters (paramsFromJson would silently ignore a typo). */
const checkPath = (path: string): void => {
  let node: unknown = DEFAULT_PARAMS
  for (const k of path.split(".")) {
    if (typeof node !== "object" || node === null || Array.isArray(node) || !Object.hasOwn(node, k))
      throw new CliError(`--set: unknown parameter "${path}" (no "${k}" there)`)
    node = (node as Record<string, unknown>)[k]
  }
}

/** Parse "a.b=1,c=x" into [path, value] pairs; numeric values become numbers. */
export const parseSets = (spec: string): Array<readonly [string, number | string]> =>
  spec
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((kv) => {
      const i = kv.indexOf("=")
      if (i <= 0 || i === kv.length - 1) throw new CliError(`--set expects key=value pairs separated by commas, got "${kv}"`)
      const k = kv.slice(0, i).trim()
      const v = kv.slice(i + 1).trim()
      return [k, Number.isFinite(Number(v)) ? Number(v) : v] as const
    })

/** A deep copy of `json` with each path set (missing objects are created); still to be checked by paramsFromJson. */
export const applySets = (json: unknown, sets: ReadonlyArray<readonly [string, number | string]>): Record<string, unknown> => {
  const out = structuredClone(json) as Record<string, unknown>
  for (const [path, value] of sets) {
    checkPath(path)
    const keys = path.split(".")
    let o = out
    for (const k of keys.slice(0, -1)) {
      const next = o[k]
      if (typeof next !== "object" || next === null || Array.isArray(next)) o[k] = {}
      o = o[k] as Record<string, unknown>
    }
    o[keys[keys.length - 1]!] = value
  }
  return out
}
