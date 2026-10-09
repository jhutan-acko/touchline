# 3D viewer, player cameras and what-if split — design

Agreed 2026-10-09 in brainstorming (sections 1–5 approved one by one). The engine was picked after a bake-off between Three.js and Babylon.js; the prototype's rulings are in §10. Extends §5.6 of `2026-10-03-touchline-design.md`. Plan 7, branch `plan-7-viewer`.

## 1. Goal

Let a fan watch any match in 3D, from any player's point of view, with several synced angles at once. When the advisor proves a better pass existed, the fan can watch it: the real play and the re-simulated better one, side by side.

**Success criteria**

- The Watch page has a 2D/3D toggle. 3D shows 22 animated players, the ball and the pitch, in sync with the existing playback.
- Four cameras: follow, first-person, broadcast, tactical. Layouts: main + mini-map, 2×2 grid, single.
- A cue with verdict `better_option_found` offers "Show me", which opens the what-if split: real vs variant, one scrubber, verified evidence beneath.
- 60 fps on an M4 Pro, at least 30 fps on a typical laptop. Without WebGL the page falls back to the 2D canvas.
- Every number on screen comes from `advisor.explainPass`, never from a model.

## 2. Engine choice

**Three.js r186 through React Three Fiber and drei.** Decided by a bake-off on 2026-10-09: the same 12 s clip in both engines (throwaway pages under `touchline-worktrees/proto-viewer/`).

| | Three.js r186 | Babylon.js 9.26 |
|---|---|---|
| Frame time (main + map / grid / split, DPR 2, M4 Pro) | 16.1 / 14.2 / 16.4 ms | 14.8 / 14.2 / 18.7 ms |
| Ambient occlusion | Every viewport | Full-canvas camera only |
| Several cameras with post-processing on one canvas | One effect chain per viewport | Needed three workarounds |
| Fit with `apps/web` (React 19) | Native via R3F | Engine inside a canvas component |
| Library weight | ~1.3 MB | ~9 MB |

The user judged the images equal, so the choice rests on multi-viewport effects, React fit and weight. Babylon's Microsoft-tech angle was weighed and declined; the Azure and agent side carries that story.

No CUDA. Rendering runs on the viewer's GPU through WebGL (Metal on macOS). A server GPU could only ever help batch what-if re-runs, and isn't needed.

## 3. Data contract

### 3.1 Player fields in frames

`Spot` (`packages/rpc/src/contracts.ts`) gains three **optional** fields: `vx`, `vy` (m/s) and `intent`. The simulator already has them; `toFrame` in `apps/api/src/playback.ts` drops them today and will round them like positions. Being optional, the 2D canvas, studio and graphics pages are unaffected.

The client derives the rest:

- **Facing:** from smoothed velocity. A still player turns to face the ball.
- **Gait:** from speed. Idle under 0.5 m/s, walk, jog, run, sprint above 7 m/s.
- **Kick:** wherever the ball suddenly speeds up beside a player (speed jump > 4 m/s to over 6 m/s, player within 2 m). This worked reliably in the spike. Pass and shot events are the fallback signal.

### 3.2 `GetWhatIf` RPC

Input: `session_id`, `event_id`. Answers as of the session's current frame, like `GetEvidence`, and refuses events in the future. Returns:

- `real`: recorded frames from 2 s before the pass to 8 s after.
- `variant`: frames for one rollout of the better option, plus the verified result from `advisor.explainPass`: option, outcomes (for example shots 7 of 20 vs 0 of 20), seeds, verdict.

**Which rollout:** play every seed and show the one whose outcome is closest to the variant's mean. Never a lucky fluke.

**Engine addition:** `playAhead` returns events and the final state but no frames. A pure `playAheadFrames` is added to `packages/sim-core/src/whatif.ts`. It follows the same determinism rules and also collects one frame per tick (the match's `fps`).

**Gate:** only cues with verdict `better_option_found` get "Show me".

### 3.3 Caching

- **Library matches:** what-ifs are computed by `pnpm library` and stored next to the cue cache, so the demo responds instantly.
- **Live sessions:** computed on request on CPU worker threads, with a "Re-simulating 20 futures…" state. Budget ~10 s.

## 4. Scene and animation

**Coordinates:** pitch `x` → Three `x`, pitch `y` → `-z`, height `z` → `y`. Metres throughout.

**Pitch and stadium**

- 105 × 68 grass plane with mowing stripes. Line markings come from the existing `drawMarkings` in `draw.ts`, drawn to a canvas texture, so 2D and 3D share one source.
- Goals: posts plus a simple net mesh.
- Low-poly stands. Lighting from the CC0 Poly Haven `stadium_01` HDRI, also shown blurred as the backdrop.
- No real brands; any boards show only the fictional league.

**Players**

- **Model:** the CC0 Quaternius Universal Animation Library mannequin (1.83 m, Rigify-style `DEF-*` bones). Trimmed with gltf-transform to the clips we use (Idle, Walk, Jog, Sprint), about 950 KB. Loaded once and cloned 22 times with `SkeletonUtils`. Licence recorded in `ATTRIBUTION.md`.
- **Kits:** the `M_Main` material takes the team's kit colour (`Kits` already exists); keepers get their own. Shirt numbers are canvas textures from `MatchInfo`.
- **Gait:** one mixer per player, cross-fading by speed. The run cycle's rate scales with actual speed so feet don't slide.
- **Kick:** our own keyframe overlay, since no CC0 kick exists for this rig. It rotates thigh, shin, foot, support leg and spine about each bone's local X axis over 0.7 s, striking at 0.45 s. The sign is −1 on this rig. The previous overlay is undone before the mixer runs and re-applied after, so rotations never accumulate. The kicker squares up to the pass direction and uses the player's `preferredFoot`. Keyframe values are taken from the spike's `template.html` (`KICK_KEYS`).
- **Facing:** turns smoothly toward travel, or toward the ball when still.

**Ball:** textured sphere spinning with its speed, at its real height, with a blob shadow so height reads in 3D.

**Rendering:** ACES Filmic tone mapping, exposure 0.85; environment intensity 0.45, background 0.35 with blur 0.25; hemisphere 0.25 plus one shadow-casting sun. Per viewport: MSAA HalfFloat target, GTAO (skipped for tactical), light bloom, output pass. These are the spike's tuned values.

**Smooth motion:** the renderer runs ~80 ms behind the newest frame and interpolates, so it stays smooth at 60 fps despite network jitter. Speed and pause come from the existing `Playback`.

**Performance:** pixel ratio capped at 2; one shadow-casting light. Player positions update through refs in `useFrame`, never React state. No WebGL → the existing 2D canvas.

**New dependencies:** `three`, `@react-three/fiber`, `@react-three/drei`. Post-processing uses three's own `EffectComposer` per viewport, as proven in the spike. Versions pinned outside pnpm's release-age window.

## 5. Cameras and the multi-angle view

All cameras share one match clock.

| Camera | Behaviour |
|---|---|
| **Follow** | ~7 m behind and ~3 m above the chosen player, looking just ahead. Spring-damped. Pulls back when the ball is far so both stay in frame. FOV 55°. |
| **First-person** | Eye height 1.72 m, FOV 75°. Looks along travel blended toward the ball. Own body hidden. Turn rate capped, subtle head-bob, to avoid motion sickness. |
| **Broadcast** | High in the main stand on halfway. Pans and zooms with the ball, damped. FOV ~26°. |
| **Tactical** | Orthographic top-down; the 3D twin of today's 2D view. |

**Choosing the player:** click any player in any view (raycast), or default to the profile's **player focus**. Keys `1`–`4` switch camera, `[` `]` step through players, space pauses. If the followed player leaves the pitch, switch to broadcast with a short notice.

**Layouts**, all on one WebGL canvas with drei `<View>` (scissored viewports):

- **Main + mini-map** (default): chosen camera plus a tactical inset.
- **Grid 2×2:** all four cameras.
- **Single:** one camera with a switcher.
- **Phones** (under ~768 px): single only.

**Overlays:** cue cards and the Why? drawer stay HTML over the main view. `pitch_marker` cues become labels pinned to players (drei `<Html>`) in every view where the player is visible.

**Where it lives:** a 2D/3D toggle on the Watch page, remembered per viewer. Demo mode (two profiles side by side) works in 3D.

## 6. What-if split

**Entry**

1. A `better_option_found` cue shows **"Show me"** in its Why? drawer.
2. Clicking pauses this viewer only; the session and other viewers carry on.
3. The app calls `GetWhatIf`. Cached results show at once; live ones show "Re-simulating 20 futures…".

**Split screen**

- Left, **"What happened"**: recorded frames, 2 s before the pass to 8 s after.
- Right, **"What if: pass to #N (Name)"**: the typical rollout from the same frame.
- Same camera type and player in both halves; default follow on the passer. One scrubber and play/pause drive both, frame for frame. Switching camera switches both.
- **Divergence:** identical until the pass. Then a brief highlight, a dashed line for the alternative pass, and 0.5× slow motion for 1 s.

**Evidence strip** beneath both halves: "Better in 7 of 20 re-runs vs 0 of 20", with the outcome metric named and the seed count, linking to the existing Why? evidence. Numbers straight from `explainPass`.

**Exit:** "Back to live" closes the split and resumes where the viewer left off (on a live session, at the current frame). It's a viewer-side replay: it never touches the studio queue or the graphics page.

**Phones:** the halves stack vertically.

**Demo video:** in demo mode on a library match, the clearest `better_option_found` moment can auto-play, so the < 2 min video shows it without clicks.

**Errors**

- Failure or timeout: "Couldn't re-simulate this moment"; the view returns to normal.
- If a fresh live result's verdict isn't better, say so honestly ("The pass played was the best option") and skip the split.

## 7. Testing

Vitest + jsdom, as in the rest of `apps/web`.

- **Pure maths in plain `.ts` modules** (no WebGL), like `draw.ts`: coordinate mapping; interpolation and the 80 ms delay; facing and smoothing; speed-to-gait bands and run-cycle rate; kick detection and kick keyframe sampling; each camera's pose from player, ball and previous pose (turn-rate cap, pull-back framing); layout breakpoints; typical-rollout selection.
- **sim-core:** `playAheadFrames` is deterministic (same state and seed → identical frames) and matches `playAhead`'s events and final state.
- **api:** `GetWhatIf` answers as of the session frame and refuses future events; returns a split only for `better_option_found`; uses the library cache; times out into an error.
- **Contract:** the new `Spot` fields are optional; 2D, studio and graphics tests stay green unchanged.
- **Components:** R3F scenes with a mocked canvas: the toggle, layout switch, click-to-follow (mocked raycast), the "Show me" flow.
- **Browser (Chrome):** frame rate on the M4 Pro (measured with a GPU-synced benchmark, since hidden tabs throttle `requestAnimationFrame`); all four cameras; the grid; the split on a library match; phone width; the 2D fallback.

## 8. Delivery

- **Worktree:** `touchline-worktrees/plan-7-viewer`, branch `plan-7-viewer`, alongside Plan 6b. Prototypes stay out of `/tmp`.
- **Overlap with 6b:** only `sim-core/whatif.ts`, which gains `playAheadFrames` and nothing else changes. Whichever merges second rebases.
- **Assets:** the trimmed mannequin `.glb` and the stadium HDRI go into `apps/web/public/` with their CC0 notices in `ATTRIBUTION.md`. The trim script is kept as a dev script.

**Milestones**, each demo-able:

1. Contract fields; scene, pitch and stadium lighting; players animated by speed with the kick; broadcast and tactical cameras; 2D/3D toggle.
2. Follow and first-person cameras; click-to-follow; layouts including the grid; 3D pitch markers.
3. `playAheadFrames`; `GetWhatIf` with the library cache; the split view; the evidence strip; demo auto-play.

**If time runs short:** cut the grid and demo auto-play first. Milestones 1 and 3 are the core.

## 9. Out of scope

CUDA or server GPUs; a free "any moment" what-if sandbox; stadium crowds; multi-match views; facial or kit detail beyond colours and numbers.

## 10. Rulings from the prototype (2026-10-09)

Building the prototype changed these points. The implementation plan follows the rulings, not the sections above.

1. **Where the split comes from (user decision).** Agents' `better_option` claims were checked by re-simulation in six costly-error matches: 0 of 5 came out `better_option_found` (3 "played pass was best", 2 not verifiable). Scanning every pass instead finds them: 8 of 498 attacking passes in one match. So `pnpm library` scans each match's passes (at least 3 options on record, played more than 5 m into the opponents' half) across worker threads, and every verified better pass becomes its own verified **better-pass cue** in each mode and language, with "Show me" in its Why? drawer. Agent claims keep their clip and get the honest verdict. Live sessions compute on request only (no live scan).
2. **No new frame fields.** Tracking stores each player's speed as a single number and no intent, so `Spot` is unchanged. The client works out velocity, facing and gait from consecutive positions.
3. **Preferred foot** is added to `MatchInfo.players` (`foot`), so the kick uses the right leg.
4. **No 3D pitch markers.** Nothing produces `pitch_marker` cues today (no agent, no stats path), so there is nothing to pin.
5. **No drei.** React Three Fiber hosts the canvas, its size and pixel ratio, and the frame loop. The scenes are plain three.js, two per canvas in the split, each viewport with its own effects chain (drei `<View>` cannot post-process per view).
6. **Following** starts with the player nearest the ball (profiles have no player focus setting).
7. **Clips stop at the session's frame.** Both plays are cut there, so nothing after it is shown. Better-pass cues appear only once their 8 seconds have played.
8. **Demo auto-show** is a checkbox on the Watch page that opens the split on each better-pass cue (no ranking of the "clearest").
9. **Kicks** count once per touch, because a kick seen across skipped frames would otherwise count twice. r186 has no soft shadow map, so `PCFShadowMap` is used.
10. **Assets** are committed in `apps/web/public/3d/`. How the body was trimmed is recorded in `ATTRIBUTION.md` instead of a script, which would need the 14 MB source pack and a new dev dependency.

## 11. Follow-ups to other docs

- `2026-10-03-touchline-design.md` §5.6: a pointer to this design.
- Roadmap: a Plan 7 row.
