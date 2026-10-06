# Agent evaluation against scripted ground truth

Models: stub. Explanation accuracy judged by: keyword rubric.

Definitions: spec §5.3.1. Recall counts achieved script truths and errors that led to a shot; a moment counts within its truth's window plus 2 minutes.

| Run | Moments | Moment recall | Moment precision | Explanation accuracy | Evidence correctness | Grounding (first draft) | Grounding (published) | Decision feedback | Persona separation |
|---|---|---|---|---|---|---|---|---|---|
| eval-late_comeback-1 | 37 | 100 % | 100 % | 100 % | 100 % | 100 % | 100 % | – | 100 % |
| eval-red_card_collapse-1 | 28 | 100 % | 100 % | 100 % | 100 % | 100 % | 100 % | – | 100 % |
| eval-keeper_heroics-1 | 32 | 100 % | 100 % | 80 % | 100 % | 100 % | 100 % | 100 % | 100 % |
| eval-costly_error-1 | 27 | 67 % | 100 % | 100 % | 100 % | 100 % | 100 % | – | 100 % |
| eval-high_press_vs_low_block-1 | 33 | 100 % | 100 % | 80 % | 80 % | 100 % | 100 % | 100 % | 100 % |
| eval-even_contest-1 | 37 | 100 % | 100 % | 100 % | 100 % | 100 % | 100 % | – | 100 % |
| **All (6 runs)** | 194 | **94 %** | **100 %** | **88 %** | **94 %** | **100 %** | **100 %** | **100 %** | **100 %** |
