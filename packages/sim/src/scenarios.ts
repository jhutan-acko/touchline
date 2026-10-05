import type { Script } from "@touchline/sim-core"

/** A built-in scenario: its script, a description, and the fixture it is designed for. */
export interface Scenario {
  readonly script: Script
  readonly description: string
  readonly home: string
  readonly away: string
}

/** The built-in scenarios (spec §5.1.7). Windows are match minutes; the second half's window runs to 95 to include added time. */
export const SCENARIOS: Readonly<Record<string, Scenario>> = {
  even_contest: {
    description: "No script: a plain match between two balanced sides",
    home: "kestrel-bay",
    away: "eastvale",
    script: { name: "even_contest", entries: [] }
  },
  late_comeback: {
    description: "The away side lead 2-0 by 70', then the home side score three times",
    home: "eastvale",
    away: "ironmoor",
    script: {
      name: "late_comeback",
      entries: [
        { window: [0, 70], team: "away", effect: "goal", count: 2 },
        { window: [70, 95], team: "home", effect: "goal", count: 3 }
      ]
    }
  },
  red_card_collapse: {
    description: "A home player is sent off between 50' and 60'; the away side then score twice",
    home: "harrowmere",
    away: "corrin-forge",
    script: {
      name: "red_card_collapse",
      entries: [
        { window: [50, 60], team: "home", effect: "red_card" },
        { window: [60, 95], team: "away", effect: "goal", count: 2 }
      ]
    }
  },
  keeper_heroics: {
    description: "The home keeper makes a string of saves between 55' and 85'",
    home: "saltmarsh",
    away: "ironmoor",
    script: { name: "keeper_heroics", entries: [{ window: [55, 85], team: "home", effect: "keeper_heroics" }] }
  },
  costly_error: {
    description: "A home defender mis-hits a pass under pressure between 60' and 75', and the away side score",
    home: "northwick",
    away: "larkspur",
    script: {
      name: "costly_error",
      entries: [
        { window: [60, 75], team: "home", effect: "defensive_error" },
        { window: [60, 75], team: "away", effect: "goal" }
      ]
    }
  },
  high_press_vs_low_block: {
    description: "A high-pressing side surges against a low block for the whole match",
    home: "corrin-forge",
    away: "northwick",
    script: { name: "high_press_vs_low_block", entries: [{ window: [0, 95], team: "home", effect: "press_surge" }] }
  }
}
