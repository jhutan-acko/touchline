# Agent evaluation against scripted ground truth

Models: openai:gpt-6.1-sol. Explanation accuracy judged by: LLM judge (openai:gpt-6.1-sol).

Definitions: spec §5.3.1. Recall counts achieved script truths and errors that led to a shot; a moment counts within its truth's window plus 2 minutes.

| Run | Moments | Moment recall | Moment precision | Explanation accuracy | Evidence correctness | Grounding (first draft) | Grounding (published) | Decision feedback | Persona separation |
|---|---|---|---|---|---|---|---|---|---|
| eval-costly_error-1 | 23 | 67 % | 100 % | 100 % | 100 % | 100 % | 100 % | 83 % | 100 % |
| **All (1 runs)** | 23 | **67 %** | **100 %** | **100 %** | **100 %** | **100 %** | **100 %** | **83 %** | **100 %** |
