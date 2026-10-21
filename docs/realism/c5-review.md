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
| `c5-3000` | Seed 3000, ironmoor against kestrel-bay | 0-0 |
| `c5-3001` | Seed 3001, ironmoor against kestrel-bay | 0-3 |
| `c5-heroics` | Scenario `keeper_heroics`, seed 1 | 3-0 |
| `c5-comeback` | Scenario `late_comeback`, seed 1 | 4-2 |

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
| `c5-3000` | 7 | **0** | **2** | **0** | **2** | 5 |
| `c5-3001` | 8 | **1** | 4 | **1** | **2** | 5 |
| `c5-heroics` | 6 | **0** | 4 | **1** | **0** | 5 |
| `c5-comeback` | 11 | **0** | 3 | **0** | **0** | 5 |

- First-time goals, lay-offs and quick saves are rare in the engine: 1 first-time goal, 2 lay-offs and 4 quick saves in the
  four matches.
- `late_pass` is capped at 5 per match by the clip lister.
- The verdict is **PENDING**: the user's review of these matches. It will be recorded in the spec's Results: P6 section and in
  the realism contract.


## Clip list

Times are match minutes (the second half continues from 45:00).

### c5-3000

| Category | Period | Time | Player |
|---|---|---|---|
| first_time | first_half | 3:45 | p-kes-08 |
| header | first_half | 3:45 | p-kes-08 |
| first_time | first_half | 5:46 | p-kes-07 |
| quick_save | first_half | 9:28 | p-iro-09 |
| first_time | first_half | 10:03 | p-iro-06 |
| header | first_half | 10:03 | p-iro-06 |
| first_time | first_half | 10:38 | p-iro-04 |
| first_time | first_half | 20:13 | p-iro-06 |
| quick_save | first_half | 44:57 | p-kes-09 |
| first_time | first_half | 47:41 | p-iro-07 |
| first_time | second_half | 77:20 | p-kes-10 |
| late_pass | second_half | 80:46 | p-iro-03 |
| late_pass | second_half | 80:48 | p-iro-03 |
| late_pass | second_half | 80:53 | p-iro-20 |
| late_pass | second_half | 81:33 | p-kes-19 |
| late_pass | second_half | 82:57 | p-iro-18 |

### c5-3001

| Category | Period | Time | Player |
|---|---|---|---|
| lay_off | first_half | 6:08 | p-kes-07 |
| first_time | first_half | 6:13 | p-kes-11 |
| quick_save | first_half | 14:36 | p-kes-05 |
| first_time | first_half | 14:58 | p-kes-08 |
| header | first_half | 14:58 | p-kes-08 |
| first_time | first_half | 40:12 | p-kes-10 |
| first_time_goal | first_half | 40:12 | p-kes-10 |
| header | first_half | 40:12 | p-kes-10 |
| first_time | second_half | 59:29 | p-kes-04 |
| header | second_half | 59:29 | p-kes-04 |
| first_time | second_half | 69:43 | p-kes-16 |
| late_pass | second_half | 80:06 | p-kes-10 |
| late_pass | second_half | 80:21 | p-kes-01 |
| quick_save | second_half | 80:27 | p-iro-19 |
| late_pass | second_half | 80:52 | p-iro-18 |
| late_pass | second_half | 80:52 | p-kes-18 |
| late_pass | second_half | 80:54 | p-kes-18 |
| first_time | second_half | 82:36 | p-kes-08 |
| header | second_half | 82:36 | p-kes-08 |
| first_time | second_half | 84:19 | p-kes-04 |
| first_time | second_half | 92:00 | p-iro-16 |

### c5-comeback

| Category | Period | Time | Player |
|---|---|---|---|
| first_time | first_half | 4:31 | p-iro-03 |
| first_time | first_half | 13:48 | p-evu-06 |
| header | first_half | 13:48 | p-evu-06 |
| first_time | first_half | 14:44 | p-evu-11 |
| header | first_half | 14:44 | p-evu-11 |
| first_time | first_half | 33:21 | p-iro-09 |
| first_time | first_half | 36:29 | p-iro-06 |
| first_time | second_half | 51:18 | p-iro-10 |
| first_time | second_half | 52:01 | p-evu-11 |
| first_time | second_half | 53:16 | p-evu-11 |
| first_time | second_half | 57:05 | p-evu-04 |
| header | second_half | 57:05 | p-evu-04 |
| first_time | second_half | 58:44 | p-iro-09 |
| first_time | second_half | 58:55 | p-iro-10 |
| late_pass | second_half | 80:25 | p-iro-05 |
| late_pass | second_half | 80:31 | p-evu-06 |
| late_pass | second_half | 80:33 | p-iro-07 |
| late_pass | second_half | 81:12 | p-evu-17 |
| late_pass | second_half | 81:26 | p-iro-13 |

### c5-heroics

| Category | Period | Time | Player |
|---|---|---|---|
| first_time | first_half | 21:52 | p-iro-08 |
| first_time | first_half | 24:31 | p-sal-09 |
| first_time | second_half | 66:51 | p-sal-08 |
| header | second_half | 66:51 | p-sal-08 |
| first_time | second_half | 71:16 | p-sal-11 |
| header | second_half | 71:16 | p-sal-11 |
| first_time | second_half | 71:52 | p-sal-11 |
| header | second_half | 71:52 | p-sal-11 |
| first_time | second_half | 73:59 | p-iro-06 |
| header | second_half | 73:59 | p-iro-06 |
| late_pass | second_half | 80:07 | p-sal-01 |
| late_pass | second_half | 80:21 | p-iro-10 |
| late_pass | second_half | 81:05 | p-sal-01 |
| late_pass | second_half | 81:35 | p-iro-02 |
| late_pass | second_half | 82:16 | p-sal-07 |
| lay_off | second_half | 86:42 | p-iro-03 |

