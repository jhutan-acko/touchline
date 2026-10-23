# Pause and ask: candidate demo moments

Proposed 2026-10-23 for the user to choose from on 2026-10-25. The cache is not built yet: run `pnpm --filter @touchline/api ask-cache` (below) for the frames that get picked.

## Where these come from

- **Library.** The P6 C5 replay set (`touchline-worktrees/p6-task8/out/c5-review`: `c5-3000`, `c5-3001`, `c5-comeback`, `c5-heroics`). The post-P6 library has not been rebuilt yet. If the rebuilt library's runs differ from these, run the scan again on it before building the cache: the frames below belong to these runs only.
- **Scan.** For each match, 40 frames were sampled evenly over its completed passes, each taken 5 frames (0.5 s) after the pass arrived. At each frame the scan built the API's frame summary and chips on the warm Ask worker, the same code `SuggestQuestions` runs. Where the `why_not_pass` chip existed, it ran the chip's what-if clip, the same `computeAskClip` that `Ask` runs (20 seeds, 10 s horizon). The verdict comes from that clip, not from a model, so no LLM was called.
- **Result.** Of 160 frames, 80 had a `why_not_pass` chip. Of those 80, 1 was `better_option_found`, 1 was `played_pass_was_best` and 78 were `not_verified`. A decided verdict is rare, so the video has few "the alternative was better" moments to choose from. A wider scan of the rebuilt library (more frames per match) would probably find more.

## Candidates

| # | Match | Frame | Clock | Verdict (UI wording) | Suggested chip |
|---|-------|-------|-------|----------------------|----------------|
| 1 | `c5-3001` | 45085 | 70:11 | better_option_found ("the alternative was better") | `45085:why_not_pass`: "Why didn't Iloris Okarovic pass to Taric Lumham?" |
| 2 | `c5-comeback` | 2787 | 04:38 | played_pass_was_best ("what he did was as good or better") | `2787:why_not_pass`: "Why didn't Tamir Ashardt pass to Lotan Ostoway?" |
| 3 | `c5-heroics` | 7644 | 12:44 | not_verified ("too close to call") | `7644:why_not_pass`: "Why didn't Lobo Sundford pass to Katan Brekisse?" |
| 4 | `c5-3000` | 41812 | 65:14 | not_verified ("too close to call") | `41812:why_not_pass`: "Why didn't Meric Okarisse pass to Lotan Ostoway?" |

The cache keys are `"<frame>:<chip_id>"`, for example `45085:45085:why_not_pass`.

### 1. `c5-3001`, frame 45085 (70:11): the headline moment

- **The clip.** It forks at frame 45069. Over 20 seeds, the shots in the next 10 s go from 2 to 5, and the gain is +0.0101 ± 0.0040 (about 2.6 standard errors). That is only just over the verdict's minimum gain of 0.01, so check it again on the rebuilt library.
- **Why it suits the video.** It is the only clear "the alternative was better" verdict in the scan, so the ghost pass and the variant clip have a real result behind them. It is late in the match, so the score is at stake.
- **Other chips at this frame.** `what_if_pass`, `pressers` and `plan` all appear here, so the panel shows all four chips. That makes a good first frame for the screen.

### 2. `c5-comeback`, frame 2787 (04:38): the honest counterpoint

- **The clip.** It forks at frame 2774. The pass the player chose comes out ahead: shots 14 against 10 for the alternative, goals 3 against 1, and the gain is −0.039 ± 0.015 (−2.5 standard errors).
- **Why it suits the video.** It shows that Ask does not always second-guess the player: the model can back the choice he made. It is also the `late_comeback` scenario, so the same match can be used for a later moment.
- **Other chips at this frame.** `what_if_pass` and `plan`.

### 3. `c5-heroics`, frame 7644 (12:44): the gate holding back

- **The clip.** It forks at frame 7615. The z-score is +2.5, but the gain (+0.0028) is under the verdict's minimum gain and no shots follow, so the answer is "too close to call".
- **Why it suits the video.** It shows the verdict refusing to overclaim on a small edge.
- **Other chips at this frame.** `what_if_pass` and `plan`.

### 4. `c5-3000`, frame 41812 (65:14): a spare

- **The clip.** It forks at frame 41795. The gain is −0.0025 (−2.5 standard errors) and no shots follow, so the answer is "too close to call".
- **Why it is here.** It is a fallback if a different match is wanted for the "too close to call" beat.
- **Other chips at this frame.** Only `plan`, because there is no holder option for `what_if_pass`.

## Building the cache once the user picks

With the agent service running on the real model (`TOUCHLINE_LLM=openai uv run --project services/agents touchline-agents --port 8100`), and with `<library>` set to the folder of run folders the demo API serves:

```sh
pnpm --filter @touchline/api ask-cache --library <library> --match c5-3001 --frames 45085 --agents http://127.0.0.1:8100/
```

- **What it writes.** It writes `<library>/c5-3001/ask-cache.json`, with an answer for every chip suggested at each frame.
- **One viewer per run.** The answers are written for one viewer: `--lang en --mode casual` by default. The cache key has no segment, so a replayed answer is in that language for every viewer.
- **Failures.** An ask that fails is listed, and the command then exits 1. A failed ask never replaces an entry already in the file.
