import type { DomainEvent, PendingEvent, Period } from "./types.js"

/** CDF match clock "MM:SS.mm"; the second half starts at 45:00.00. */
export const matchClock = (period: Period, periodTick: number, dt: number): string => {
  const total = (period === "first_half" ? 0 : 45 * 60) + periodTick * dt
  const mm = Math.floor(total / 60)
  const ss = total - mm * 60
  const ssText = (Math.round(ss * 100) / 100).toFixed(2).padStart(5, "0")
  return `${String(mm).padStart(2, "0")}:${ssText}`
}

export interface EventContext {
  readonly matchId: string
  readonly period: Period
  /** Global tick of the period's first frame, to convert global ticks to CDF frame ids. */
  readonly periodStartTick: number
  readonly dt: number
}

export const buildEvent = (
  ctx: EventContext,
  seq: number,
  pending: PendingEvent,
  extra: { readonly frame_id_end?: number | null; readonly outcome?: string | null } = {}
): DomainEvent => {
  const periodFrame = pending.frame_id - ctx.periodStartTick
  return {
    id: `${ctx.matchId}-e${seq}`,
    match_id: ctx.matchId,
    type: pending.type,
    frame_id: pending.frame_id,
    period_frame_id: periodFrame,
    period: ctx.period,
    match_clock: matchClock(ctx.period, periodFrame, ctx.dt),
    team_id: pending.team_id,
    player_id: pending.player_id,
    x: pending.x === null ? null : round2(pending.x),
    y: pending.y === null ? null : round2(pending.y),
    x_end: pending.x_end === null ? null : round2(pending.x_end),
    y_end: pending.y_end === null ? null : round2(pending.y_end),
    frame_id_end: extra.frame_id_end ?? null,
    outcome: extra.outcome ?? null,
    source: "sim",
    confidence: 1,
    attrs: pending.attrs
  }
}

export const round2 = (v: number): number => Math.round(v * 100) / 100
