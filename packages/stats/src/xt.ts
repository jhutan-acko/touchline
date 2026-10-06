/**
 * Expected threat (xT, spec §5.2 `act.xt`): a 12 x 8 grid fitted on IDSSE in Python
 * (python/analytics/touchline_analytics/xt.py, data/params/xt-grid.json). Cells are seen by the team in
 * possession attacking +x; the cell indexing is the same in both languages (shared test vectors).
 */
import { PITCH } from "@touchline/sim-core"

export interface XtGrid {
  readonly version: string
  readonly cols: number
  readonly rows: number
  /** Row-major, row 0 at y = -34 for a team attacking +x. */
  readonly values: ReadonlyArray<number>
}

export class XtError extends Error {}

export const xtGridFromJson = (raw: unknown): XtGrid => {
  const j = raw as { version?: unknown; cols?: unknown; rows?: unknown; values?: unknown }
  if (typeof j?.version !== "string") throw new XtError("version must be a string")
  if (!Number.isInteger(j.cols) || !Number.isInteger(j.rows) || (j.cols as number) < 1 || (j.rows as number) < 1) throw new XtError("cols and rows must be positive integers")
  const n = (j.cols as number) * (j.rows as number)
  if (!Array.isArray(j.values) || j.values.length !== n || !j.values.every((v) => typeof v === "number" && v >= 0 && v <= 1))
    throw new XtError(`values must be ${n} numbers between 0 and 1`)
  return { version: j.version, cols: j.cols as number, rows: j.rows as number, values: j.values as number[] }
}

/** The cell of a point seen by a team attacking +x (`attack` = 1) or -x (`attack` = -1). */
export const xtCell = (g: Pick<XtGrid, "cols" | "rows">, x: number, y: number, attack: 1 | -1): number => {
  const xn = attack * x
  const yn = attack * y
  const col = Math.min(g.cols - 1, Math.max(0, Math.floor(((xn + PITCH.halfL) / PITCH.length) * g.cols)))
  const row = Math.min(g.rows - 1, Math.max(0, Math.floor(((yn + PITCH.halfW) / PITCH.width) * g.rows)))
  return row * g.cols + col
}

/** Expected threat of having the ball at a point, for a team attacking `attack`. */
export const xtAt = (g: XtGrid, x: number, y: number, attack: 1 | -1): number => g.values[xtCell(g, x, y, attack)]!
