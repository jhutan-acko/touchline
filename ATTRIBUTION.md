# Attribution

Touchline's simulator is original code. These projects and papers shaped its design; no code was copied from them, except the pitch-control model, which is ported from LaurieOnTracking (MIT, below).

| Source | Licence | What we took |
|---|---|---|
| [tbleckert/football-simulator](https://github.com/tbleckert/football-simulator) | MIT | Ideas: typed event taxonomy, restart phase machine, intents with durations, injectable RNG |
| [ZOXEXIVO/open-football](https://github.com/ZOXEXIVO/open-football) | Apache-2.0 | Ideas: constant-bearing interception, 3D ball physics, per-match plausibility bands |
| Spearman (2018) pitch control, via [LaurieOnTracking](https://github.com/Friends-of-Tracking-Data-FoTD/LaurieOnTracking) (© 2021 Friends-of-Tracking-Data-FoTD) | MIT | `calculate_pitch_control_at_target` ported to TypeScript with its default parameters (`packages/sim-core/src/pitchcontrol.ts`, checked against values from the original); the 0.7 s reaction time in time-to-intercept |
| Singh (2019) expected threat, via [socceraction](https://github.com/ML-KULeuven/socceraction)'s `xthreat` module | MIT | The method: value iteration over moves and shots on a grid (our implementation, `touchline_analytics/xt.py`) |
| Reynolds, *Steering Behaviors for Autonomous Characters* (GDC 1999) | — | Arrive, pursue and separation steering |
| Anzer et al., *Common Data Format (CDF)*, arXiv:2505.15820 | — | Output format (v0.3.2) |
| [unravelsports/common-data-format-validator](https://github.com/unravelsports/common-data-format-validator) | MIT | CDF validation in CI |
| [Effect](https://effect.website) | MIT | Streams, schemas and test clock |

## Calibration data

| Dataset | Licence | How it is used |
|---|---|---|
| IDSSE / Sportec Open DFL dataset — © Deutsche Fussball Liga (DFL); Bassek et al., *Scientific Data* (2025), https://doi.org/10.1038/s41597-025-04505-y | CC-BY 4.0 | Downloaded locally into git-ignored `data/raw/`; only aggregate match statistics (`data/params/targets-idsse.json`), fitted model coefficients (`data/params/stats-models.json`) and the expected-threat grid (`data/params/xt-grid.json`) are committed. These are the targets the engine is tuned to and validated against (`docs/realism/realism-report.md`). |

The default xG prior (`packages/sim-core/src/params.ts`) is fitted to an approximate public reference xG curve by distance and angle, not to any dataset.
