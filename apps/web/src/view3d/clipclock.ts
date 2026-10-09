/**
 * The what-if split's clock (Plan 7), pure: where in the clip (a fractional frame index) playback is after `dt`
 * seconds, in slow motion for a moment after the pass, looping back to just before the pass at the end.
 */

/** Slow motion right after the pass: this fast, ... */
export const SLOW = 0.5
/** ... for this many seconds of the clip. */
export const SLOW_S = 1
/** A loop starts this many seconds before the pass. */
export const LEAD_S = 1.8

export interface ClipTiming {
  readonly fps: number
  readonly passIndex: number
  /** Frames in the clip. */
  readonly length: number
}

/** Where the clip starts (and loops back to): a little before the pass. */
export const loopStart = (c: ClipTiming): number => Math.max(0, c.passIndex - LEAD_S * c.fps)

/** Whether index `f` is in the slow-motion stretch after the pass. */
export const isSlow = (c: ClipTiming, f: number): boolean => f >= c.passIndex && f < c.passIndex + SLOW_S * c.fps

/** The index after `dt` seconds at `speed`. */
export const advance = (c: ClipTiming, f: number, dt: number, speed: number): number => {
  const next = f + dt * c.fps * speed * (isSlow(c, f) ? SLOW : 1)
  return next >= c.length - 1 ? loopStart(c) : next
}
