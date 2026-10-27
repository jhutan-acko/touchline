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
| `c5-3000` | Seed 3000, ironmoor against kestrel-bay | 2-0 |
| `c5-3001` | Seed 3001, ironmoor against kestrel-bay | 0-3 |
| `c5-heroics` | Scenario `keeper_heroics`, seed 1 | 0-4 |
| `c5-comeback` | Scenario `late_comeback`, seed 1 | 6-2 |

Rebuilt 2026-10-22 after the P6 pre-merge fixes (no first-time finishes or headers from corners and free kicks,
`marking_weight` 0.75, recalibrated; script nudges `heroicsSave` 1.75, `goalRatePerMin` 0.02, `pressSurge` 30).

Rebuilt 2026-10-26 after the P6 off-ball fix (calm repositioning, `movement.accelRule` 1, `accelShare` 0.35) and one
re-tune round (tuner knobs kept except `choice_temp`, `long_shift` and `aerial_contest`, which stay at their previous values).

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
| `c5-3000` | 5 | **0** | **0** | 3 | **0** | 5 |
| `c5-3001` | 4 | **0** | **0** | **0** | **1** | 5 |
| `c5-heroics` | 8 | **1** | **1** | **2** | **0** | 5 |
| `c5-comeback` | 6 | **0** | **0** | **0** | **0** | 5 |

- First-time goals, headers, lay-offs and quick saves are rare in the engine: 1 first-time goal (in `c5-heroics`), 1
  header, 5 lay-offs and 1 quick save in the four matches (2026-10-22 build: 4, 1, 0 and 5). Headers fell from 13 (P6 Task 8) to 1: set-piece headers are
  off since the pre-merge fix, and open-play headers are about 0.012 of open-play shots.
- `late_pass` is capped at 5 per match by the clip lister.
- The verdict is **PENDING**: the user's review of these matches. It will be recorded in the spec's Results: P6 section and in
  the realism contract.


## Clip list

Times are match minutes (the second half continues from 45:00).

### c5-3000

| Category | Period | Time | Player |
|---|---|---|---|
| first_time | first_half | 8:07 | p-kes-09 |
| first_time | first_half | 22:54 | p-kes-10 |
| first_time | first_half | 25:02 | p-iro-09 |
| first_time | first_half | 26:15 | p-iro-07 |
| lay_off | second_half | 46:32 | p-kes-10 |
| lay_off | second_half | 46:32 | p-kes-09 |
| lay_off | second_half | 48:24 | p-kes-07 |
| first_time | second_half | 55:19 | p-iro-10 |
| late_pass | second_half | 80:14 | p-iro-03 |
| late_pass | second_half | 80:15 | p-iro-03 |
| late_pass | second_half | 80:16 | p-iro-03 |
| late_pass | second_half | 80:19 | p-kes-08 |
| late_pass | second_half | 80:38 | p-kes-02 |

### c5-3001

| Category | Period | Time | Player |
|---|---|---|---|
| first_time | first_half | 21:38 | p-kes-06 |
| first_time | second_half | 50:00 | p-iro-10 |
| quick_save | second_half | 76:36 | p-iro-11 |
| first_time | second_half | 77:33 | p-iro-08 |
| late_pass | second_half | 80:31 | p-iro-04 |
| late_pass | second_half | 80:35 | p-iro-04 |
| first_time | second_half | 80:43 | p-kes-10 |
| late_pass | second_half | 81:17 | p-iro-04 |
| late_pass | second_half | 82:06 | p-iro-02 |
| late_pass | second_half | 82:10 | p-kes-18 |

### c5-comeback

| Category | Period | Time | Player |
|---|---|---|---|
| first_time | first_half | 5:35 | p-iro-04 |
| first_time | first_half | 9:44 | p-evu-08 |
| first_time | first_half | 26:08 | p-iro-10 |
| first_time | second_half | 46:09 | p-evu-11 |
| first_time | second_half | 55:28 | p-iro-11 |
| first_time | second_half | 57:25 | p-evu-02 |
| late_pass | second_half | 83:05 | p-evu-19 |
| late_pass | second_half | 83:07 | p-iro-05 |
| late_pass | second_half | 83:08 | p-evu-07 |
| late_pass | second_half | 83:25 | p-evu-07 |
| late_pass | second_half | 83:30 | p-evu-07 |

### c5-heroics

| Category | Period | Time | Player |
|---|---|---|---|
| lay_off | first_half | 5:12 | p-iro-10 |
| first_time | first_half | 7:39 | p-iro-09 |
| first_time | first_half | 44:47 | p-iro-10 |
| first_time | second_half | 46:59 | p-iro-08 |
| first_time | second_half | 50:51 | p-iro-09 |
| first_time_goal | second_half | 50:51 | p-iro-09 |
| first_time | second_half | 60:46 | p-iro-04 |
| first_time | second_half | 70:34 | p-sal-19 |
| header | second_half | 70:34 | p-sal-19 |
| first_time | second_half | 78:25 | p-iro-10 |
| lay_off | second_half | 78:45 | p-iro-07 |
| first_time | second_half | 78:46 | p-iro-10 |
| late_pass | second_half | 80:21 | p-iro-10 |
| late_pass | second_half | 80:34 | p-iro-16 |
| late_pass | second_half | 81:31 | p-sal-07 |
| late_pass | second_half | 82:15 | p-sal-05 |
| late_pass | second_half | 82:22 | p-iro-20 |
