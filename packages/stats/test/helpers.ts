import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { DomainEvent } from "@touchline/schema"
import type { MatchInfo, TrackFrame, TrackPlayer } from "../src/input.js"
import { modelsFromJson, type StatsModels } from "../src/models.js"
import { xtGridFromJson, type XtGrid } from "../src/xt.js"

export const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
export const models = (): StatsModels => modelsFromJson(JSON.parse(readFileSync(join(root, "data/params/stats-models.json"), "utf8")))
export const xtGrid = (): XtGrid => xtGridFromJson(JSON.parse(readFileSync(join(root, "data/params/xt-grid.json"), "utf8")))

/** Two teams of three: a keeper and two outfielders each. */
export const INFO: MatchInfo = {
  matchId: "t",
  dt: 0.1,
  home: { id: "home-fc", name: "Home", side: "home", players: [{ id: "h1", name: "H One", role: "GK", jersey: 1 }, { id: "h2", name: "H Two", role: "CM", jersey: 8 }, { id: "h3", name: "H Three", role: "ST", jersey: 9 }] },
  away: { id: "away-fc", name: "Away", side: "away", players: [{ id: "a1", name: "A One", role: "GK", jersey: 1 }, { id: "a2", name: "A Two", role: "CB", jersey: 4 }, { id: "a3", name: "A Three", role: "ST", jersey: 9 }] }
}

const at = (x: number, y = 0) => ({ x, y })
/** Everyone standing still at their default spots, with the given overrides. */
export const frame = (tick: number, over: Partial<Record<string, { x: number; y: number }>> = {}, extra: Partial<TrackFrame> = {}): TrackFrame => {
  const spots: Record<string, { x: number; y: number }> = { h1: at(-50), h2: at(-10, 5), h3: at(5, -5), a1: at(50), a2: at(20, 3), a3: at(-5, 5) }
  const players = (ids: string[]): TrackPlayer[] => ids.map((id) => ({ id, ...(over[id] ?? spots[id]!) }))
  return {
    tick,
    frame_id: tick,
    period: "first_half",
    home: players(["h1", "h2", "h3"]),
    away: players(["a1", "a2", "a3"]),
    ball: { x: 0, y: 0, z: 0 },
    ball_in_play: true,
    possession_side: "home",
    ...extra
  }
}

let seq = 0
/** A domain event with defaults (first half, frame id = tick). */
export const event = (type: DomainEvent["type"], tick: number, fields: Partial<DomainEvent> = {}): DomainEvent => ({
  id: `t-e${++seq}`,
  match_id: "t",
  type,
  frame_id: tick,
  period_frame_id: tick,
  period: "first_half",
  match_clock: "00:00.00",
  team_id: null,
  player_id: null,
  x: null,
  y: null,
  x_end: null,
  y_end: null,
  frame_id_end: null,
  outcome: null,
  source: "sim",
  confidence: 1,
  attrs: {},
  ...fields
})
