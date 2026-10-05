/**
 * Time-indexed storage. Every value is stamped with the tick at which it became known, and every read takes a
 * tick and looks only at or before it, so a query "as of tick t" gives the same answer whether the engine has
 * ingested up to t or the whole match.
 */

/** A step function of the tick: the last value pushed at or before a tick. */
export class Series {
  readonly ticks: number[] = []
  readonly values: number[] = []

  push(tick: number, value: number): void {
    const n = this.ticks.length
    if (n > 0 && this.ticks[n - 1] === tick) this.values[n - 1] = value
    else {
      this.ticks.push(tick)
      this.values.push(value)
    }
  }

  /** Index of the last entry at or before `tick`, or -1. */
  indexAt(tick: number): number {
    let lo = 0
    let hi = this.ticks.length - 1
    let best = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (this.ticks[mid]! <= tick) {
        best = mid
        lo = mid + 1
      } else hi = mid - 1
    }
    return best
  }

  at(tick: number, otherwise = 0): number {
    const i = this.indexAt(tick)
    return i < 0 ? otherwise : this.values[i]!
  }

  last(otherwise = 0): number {
    return this.values.length ? this.values[this.values.length - 1]! : otherwise
  }
}

/** Running totals per (counter, subject); a windowed total is a difference of two running totals. */
export class Counters {
  private readonly series = new Map<string, Series>()

  private get(counter: string, subject: string): Series {
    const k = `${counter}|${subject}`
    let s = this.series.get(k)
    if (!s) this.series.set(k, (s = new Series()))
    return s
  }

  add(counter: string, subject: string, tick: number, delta: number): void {
    const s = this.get(counter, subject)
    s.push(tick, s.last() + delta)
  }

  /** Total up to and including `tick`. */
  total(counter: string, subject: string, tick: number): number {
    return this.series.get(`${counter}|${subject}`)?.at(tick) ?? 0
  }

  /** Total over the ticks (from, to]; `from` = null means since kickoff. */
  between(counter: string, subject: string, from: number | null, to: number): number {
    return this.total(counter, subject, to) - (from === null ? 0 : this.total(counter, subject, from))
  }
}

/** Maximum of a Series' values over the ticks (from, to]; null with no data there. */
export const maxBetween = (s: Series | undefined, from: number | null, to: number): number | null => {
  if (!s) return null
  let best: number | null = null
  for (let i = s.indexAt(to); i >= 0 && (from === null || s.ticks[i]! > from); i--) best = Math.max(best ?? -Infinity, s.values[i]!)
  return best
}
