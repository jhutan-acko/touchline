# C5 replay review (realism v2 P6)

C5 is the user's replay review (spec "P6: shot model", plan 8f ruling 21, user Q3 (a)): four matches and a clip list, with no
agent service and no LLM. The matches play with no cues, because there is no cue cache.

## The four matches

The matches are written by `pnpm sim` with the calibrated parameters of the P6 branch into `out/c5-review/`. `out/` is not
committed, so rebuild them from the repository root when needed:

```bash
for s in 3000 3001; do pnpm sim --seed $s --match-id c5-$s --out out/c5-review/c5-$s; done
pnpm sim --scenario keeper_heroics --seed 1 --match-id c5-heroics --out out/c5-review/c5-heroics
pnpm sim --scenario late_comeback --seed 1 --match-id c5-comeback --out out/c5-review/c5-comeback
uv run --project python/analytics python -m touchline_analytics.shots clips out/c5-review/*   # the list below
```

| Match | What it is | Score |
|---|---|---|
| `c5-3000` | Seed 3000, ironmoor against kestrel-bay | 0-1 |
| `c5-3001` | Seed 3001, ironmoor against kestrel-bay | 4-0 |
| `c5-heroics` | Scenario `keeper_heroics`, seed 1 | 2-4 |
| `c5-comeback` | Scenario `late_comeback`, seed 1 | 4-2 |

Rebuilt 2026-10-22 after the P6 pre-merge fixes (no first-time finishes or headers from corners and free kicks,
`marking_weight` 0.75, recalibrated; script nudges `heroicsSave` 1.75, `goalRatePerMin` 0.02, `pressSurge` 30).

## How to watch

1. Run `pnpm api --library out/c5-review`. It should report `4 matches`.
2. In a second terminal, run `pnpm web` and open the address it prints.
3. Pick a match. For each row below, start playback a few seconds before the listed time ("from minute"), and watch until the
   ball is dead or possession changes.

## What to judge

Judge each category:

- **first_time, first_time_goal.** The finishing technique and its timing. The receiver strikes the ball on his first touch,
  with no control. Ask whether the chance suited a first-time finish (a cutback, a ball across the six-yard box, a ball
  arriving at pace), and whether the miss rate under pressure looks right.
- **header.** The header situations: a high ball (about 1–2.4 m) won in the box. Check the delivery, the winner's position and
  the direction of the header.
- **lay_off.** The lay-offs: a one-touch pass back or across to a supporting teammate within 12 m, instead of a shot or a
  control.
- **quick_save.** The keeper's positioning on quick shots, with a flight under 0.5 s. Check that he is set near the line between
  the ball and the goal centre, and not caught far off his line.
- **late_pass.** Late-match passing: misplaced open-play passes after minute 80, which show the execution as players tire.
- **C5's contract items, watched throughout every clip:**
  - Supporters offering angles to the carrier.
  - Defenders goal-side of their man.
  - Carriers shielding the ball under pressure.

## Rows per category

The plan asks for at least 3 clips per category per match. Where a match has fewer, the shortfall is recorded here, not
padded:

| Match | first_time | first_time_goal | header | lay_off | quick_save | late_pass |
|---|---|---|---|---|---|---|
| `c5-3000` | 6 | **0** | **0** | **0** | **0** | 5 |
| `c5-3001` | 3 | **0** | **0** | **0** | **2** | 5 |
| `c5-heroics` | 11 | 4 | **1** | **0** | 3 | 5 |
| `c5-comeback` | 6 | **0** | **0** | **0** | **0** | 5 |

- First-time goals, headers, lay-offs and quick saves are rare in the engine: 4 first-time goals (all in `c5-heroics`), 1
  header, no lay-off and 5 quick saves in the four matches. Headers fell from 13 (P6 Task 8) to 1: set-piece headers are
  off since the pre-merge fix, and open-play headers are about 0.012 of open-play shots.
- `late_pass` is capped at 5 per match by the clip lister.
- The verdict is **PENDING**: the user's review of these matches. It will be recorded in the spec's Results: P6 section and in
  the realism contract.


## Clip list

Times are match minutes (the second half continues from 45:00).

### c5-3000

| Category | Period | Time | Player |
|---|---|---|---|
| first_time | first_half | 4:47 | p-iro-08 |
| first_time | first_half | 10:53 | p-iro-11 |
| first_time | first_half | 33:23 | p-iro-07 |
| first_time | first_half | 46:35 | p-kes-08 |
| late_pass | second_half | 80:08 | p-kes-10 |
| late_pass | second_half | 80:15 | p-iro-03 |
| late_pass | second_half | 80:17 | p-iro-03 |
| late_pass | second_half | 80:24 | p-kes-09 |
| late_pass | second_half | 80:24 | p-kes-09 |
| first_time | second_half | 83:10 | p-kes-09 |
| first_time | second_half | 91:34 | p-iro-08 |

### c5-3001

| Category | Period | Time | Player |
|---|---|---|---|
| first_time | first_half | 11:17 | p-kes-06 |
| quick_save | first_half | 25:50 | p-iro-10 |
| quick_save | first_half | 32:23 | p-iro-11 |
| first_time | first_half | 48:49 | p-kes-10 |
| first_time | first_half | 49:21 | p-kes-04 |
| late_pass | second_half | 81:18 | p-kes-10 |
| late_pass | second_half | 81:48 | p-iro-04 |
| late_pass | second_half | 81:50 | p-kes-10 |
| late_pass | second_half | 82:10 | p-iro-19 |
| late_pass | second_half | 82:37 | p-kes-18 |

### c5-comeback

| Category | Period | Time | Player |
|---|---|---|---|
| first_time | first_half | 3:08 | p-iro-10 |
| first_time | first_half | 26:35 | p-evu-09 |
| first_time | first_half | 42:51 | p-iro-07 |
| first_time | second_half | 45:19 | p-evu-15 |
| first_time | second_half | 51:58 | p-evu-07 |
| first_time | second_half | 55:57 | p-evu-08 |
| late_pass | second_half | 80:02 | p-iro-06 |
| late_pass | second_half | 80:05 | p-iro-15 |
| late_pass | second_half | 82:23 | p-evu-08 |
| late_pass | second_half | 82:48 | p-evu-15 |
| late_pass | second_half | 82:48 | p-iro-15 |

### c5-heroics

| Category | Period | Time | Player |
|---|---|---|---|
| first_time | first_half | 17:50 | p-iro-07 |
| first_time | first_half | 26:34 | p-iro-11 |
| first_time | first_half | 40:32 | p-iro-09 |
| first_time | first_half | 43:59 | p-iro-10 |
| first_time_goal | first_half | 43:59 | p-iro-10 |
| first_time | second_half | 53:13 | p-sal-11 |
| first_time | second_half | 56:34 | p-iro-10 |
| first_time_goal | second_half | 56:34 | p-iro-10 |
| quick_save | second_half | 60:37 | p-sal-11 |
| quick_save | second_half | 61:23 | p-sal-08 |
| quick_save | second_half | 61:26 | p-sal-08 |
| first_time | second_half | 62:12 | p-sal-08 |
| first_time | second_half | 72:03 | p-iro-02 |
| first_time | second_half | 78:25 | p-iro-03 |
| first_time | second_half | 81:15 | p-iro-19 |
| first_time_goal | second_half | 81:15 | p-iro-19 |
| header | second_half | 81:15 | p-iro-19 |
| late_pass | second_half | 83:24 | p-sal-04 |
| late_pass | second_half | 84:48 | p-iro-03 |
| late_pass | second_half | 85:00 | p-sal-11 |
| late_pass | second_half | 85:12 | p-iro-06 |
| late_pass | second_half | 85:41 | p-sal-18 |
| first_time | second_half | 90:31 | p-sal-11 |
| first_time_goal | second_half | 90:31 | p-sal-11 |

