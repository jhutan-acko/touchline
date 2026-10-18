import type { ActionZone } from "./geometry.js"
import type { Role } from "./types.js"

export const ACTIONS = [
  "short_pass",
  "long_pass",
  "through_ball",
  "lofted_through",
  "switch",
  "cross",
  "cutback",
  "back_pass",
  "carry",
  "take_on",
  "shot",
  "clear",
  "hold"
] as const
export type Action = (typeof ACTIONS)[number]

export const ALLOWED_LICENCES = ["CC-BY-4.0", "MIT", "hand-set-prior"] as const

export interface Provenance {
  readonly dataset: string
  readonly licence: string
  readonly attribution: string
  readonly fitted_at: string
  readonly version: string
}

export interface ClassifierThresholds {
  readonly longPassM: number
  readonly switchLateralM: number
  readonly backPassM: number
  readonly carryMinM: number
  readonly crossOriginAbsY: number
  readonly finalThirdAttackX: number
  readonly cutbackOriginAttackX: number
  readonly cutbackTargetAttackXMin: number
  readonly cutbackTargetAttackXMax: number
  readonly cutbackTargetAbsY: number
}

/** A team's positioning row: with the ball, without it, or while its own keeper has the ball (build-up, G4). */
export type ShapeRow = "in" | "out" | "gk"
/** Positioning groups: roles with DM folded into CM; WB is a full-back in a back three (3-5-2). */
export type PosGroup = "GK" | "CB" | "FB" | "WB" | "CM" | "AM" | "W" | "ST"
/**
 * One row of the rule table, team frame (metres; u along the attack, bu/by the ball's): depth u = a + b·bu; lateral for
 * side slots s = w0 + w1·bu + w2·bs + w3·|by| (bs = by toward the player's side), for central slots y = e·by.
 */
export interface PosRow { readonly a: number; readonly b: number; readonly w0: number; readonly w1: number; readonly w2: number; readonly w3: number; readonly e: number }

/** The pass actions: every action that plays the ball to a teammate. */
export type PassAction = Exclude<Action, "carry" | "take_on" | "shot" | "clear" | "hold">
/** Pass-choice coefficients (or features), per unit of: distance/10, forward gain/10, |lateral|/10, lane blocked, min(open,10)/5, line-breaking, keeper. */
export interface ChoiceCoefs { readonly dist: number; readonly fwd: number; readonly lat: number; readonly lane: number; readonly open: number; readonly lineBreak: number; readonly keeper: number }
/** A cross target (D3): team-frame u, s metres toward the crosser's own touchline, height, and the least origin u it is offered from (0 = any). */
export interface CrossZone { readonly u: number; readonly s: number; readonly height: "high" | "ground"; readonly minOriginU: number }

export interface Params {
  readonly provenance: Provenance
  readonly kinematics: {
    /** The tuned rule for who can reach a moving ball (resolve.ts; kinematics.ts accelFor and reachIn), not physics. */
    readonly accelMax: number
    readonly reactionS: number
    readonly reachM: number
    /** Share of the straight-line reach used when judging who can get to a ball (see resolve.ts). */
    readonly reachMargin: number
    readonly controlHeightM: number
    readonly headerHeightM: number
  }
  /**
   * X1 (realism v2 P3). In the first 0.1 s of a pass's flight (resolve.ts BOOT_WINDOW_S: the first tick at 10 Hz, the
   * first three at 25 Hz) an opponent's contact point is taken at least alongM along the path from the pass start, and
   * only an opponent standing within coneDeg of the pass direction from the passer can play it then: outright if the
   * contact is within reach, otherwise by the reachable disc (with reactionS). An opponent beside or behind the passer
   * cannot play the ball in that window. The nearest outfield opponent within bootM of the passer blocks an open-play pass at the
   * boot with chance bootBlock (boot RNG stream). rule 0: the old first-tick rule, no boot blocks.
   */
  readonly firstTick: {
    readonly rule: number; readonly alongM: number; readonly coneDeg: number; readonly bootM: number; readonly bootBlock: number
    /**
     * M5 (realism v2 P4): 1 scopes X1 — no boot block on a keeper's throw or punt from his hands, and a clearance's flight
     * is resolved with firstTick.rule 0 (a defender in front can charge it down on the first tick). rule 0: the old behaviour.
     */
    readonly scopeRule: number
  }
  readonly ball: {
    readonly gravity: number
    readonly substeps: number
  }
  /**
   * Physics constants measured on real tracking: data/params/physics.json, copied into the parameter file by
   * `pnpm physics:fit`. The defaults are literature values (spec docs/superpowers/specs/2026-10-09-physics-fit-design.md).
   */
  readonly physics: {
    readonly ball: {
      /** Quadratic drag per metre (a = -drag |v| v). */
      readonly drag: number
      /** Normal coefficient of restitution at a bounce. */
      readonly restitution: number
      /** Ball-grass friction during a bounce. */
      readonly bounceFriction: number
      /** Ball-grass friction while a ball skids along the ground. */
      readonly skidFriction: number
      /** Rolling resistance rollC0 + rollC1 v (m/s^2). */
      readonly rollC0: number
      readonly rollC1: number
    }
    readonly players: {
      /** Acceleration-speed line a = A0 (1 - v / S0) by position group: the 10/25/50/75/90th percentiles of A0 and S0. */
      readonly a0: Readonly<Record<"GK" | "DEF" | "MID" | "FWD", readonly [number, number, number, number, number]>>
      readonly s0: Readonly<Record<"GK" | "DEF" | "MID" | "FWD", readonly [number, number, number, number, number]>>
      /** The league's 10/25/50/75/90th percentiles of the pace and acceleration attributes, mapped onto those of S0 and A0. */
      readonly paceKnots: readonly [number, number, number, number, number]
      readonly accelerationKnots: readonly [number, number, number, number, number]
      /** Braking cap and cap across the direction of running (m/s^2). */
      readonly brake: number
      readonly lateral: number
      /** Delay before a player who is not the intended receiver starts to respond to a kick (s). */
      readonly reactionS: number
    }
  }
  readonly timing: {
    readonly decisionMinS: number
    readonly decisionMaxS: number
    readonly keeperHoldS: number
    readonly restartDelayS: Readonly<Record<"kickoff" | "throw_in" | "corner" | "goal_kick" | "free_kick" | "penalty", number>>
    readonly addedTimeMinS: readonly [number, number]
  }
  /** D2 (P3): time on the ball after winning or receiving it (release.ts). rule 0: the flat timing.decisionMinS..MaxS draw. */
  readonly release: {
    readonly rule: number; readonly pressedM: number; readonly pressedS: readonly [number, number]; readonly tailShare: number; readonly tailMeanS: number
    /** M6 (realism v2 P4): a free (unpressed) release delay is capped at capS seconds. 0: no cap (the old behaviour). */
    readonly capS: number
    /**
     * M6 (realism v2 P4): 1 re-judges a holder whose remaining hold exceeds pressedS[1] once an opponent comes within
     * pressedM (his hold is cut to now + a pressedS draw). rule 0: the old behaviour.
     */
    readonly rejudge: number
  }
  readonly actions: {
    readonly logits: Readonly<Record<ActionZone, Readonly<Record<Action, number>>>>
    readonly styleWeight: number
    readonly pressureWeight: number
    /** Hold's logit falls by this much per second the player has had the ball (players do not stand on it). */
    readonly holdDecayPerS: number
  }
  readonly pass: {
    readonly xpass: { readonly b0: number; readonly bDist: number; readonly bLane: number; readonly bPressure: number; readonly bHigh: number }
    readonly arriveSpeed: number
    readonly highLaunchDeg: number
    readonly throughLeadM: number
    readonly choiceTemperature: number
    /**
     * How much a passer trusts pitch control at the target over the lane-based xPass when weighing options
     * (0: xPass only; 1: pitch control only). Pitch control sees who can reach the ball first, including runs.
     */
    readonly pitchControlWeight: number
    /**
     * Logit bonus per unit of the best option's arrival chance (above SAFETY_PIVOT) for each kind of pass: passers
     * choose the kind of pass by how safe its best option is, not only by habit and pressure.
     */
    readonly safetyWeight: number
    /** X2: a high ball's execution error grows by longErrorPerM per metre beyond longErrorFromM (multiplier 1 + ...; 0 = off). */
    readonly longErrorPerM: number
    readonly longErrorFromM: number
  }
  readonly execution: {
    readonly dirSigma: number
    readonly distSigma: number
    readonly pressureK: number
    readonly weakFootK: number
    readonly mishitBase: number
    readonly mishitK: number
  }
  readonly shot: {
    readonly xg: { readonly b0: number; readonly bDist: number; readonly bAngle: number; readonly bHeader: number; readonly bDefenders: number }
    readonly maxDistanceM: number
    readonly speed: number
    readonly onTargetRate: number
    /** Multiplier on shot aiming error (calibration knob for on-target share). */
    readonly aimNoise: number
    /**
     * Each outfield defender within blockWidthM of the shot's line blocks it with probability blockPerDefender x (1 - distance / blockWidthM);
     * the defender closing the shooter down blocks with probability blockPressure x pressure.
     */
    readonly blockPerDefender: number
    readonly blockWidthM: number
    readonly blockPressure: number
    /** Share of blocked shots deflected behind the goal line (corners). */
    readonly blockBehind: number
    /** Save model for shots on target (see saveChance): intercept and the effects of placement, distance and reflexes. */
    readonly save: { readonly b0: number; readonly bWide: number; readonly bEdge: number; readonly bDistance: number; readonly bReflexes: number }
  }
  /**
   * D1 (P3): pass choice as the real conditional logit (carrier-report C3). An option's utility is
   * sum_k (base_k + press_k (pressure - pressCentre)) feature_k, plus leadLane when the lane to the aimed point is blocked.
   * A pass kind's logit is the zone's short_pass logit + kindShift[kind] + inclusive (T log sum exp(U / T) - ivCentre), and
   * the receiver is drawn by softmax(U / T), T = temperature (1.4 - vision) / 0.8. rule 0: the old value and choice.
   */
  readonly choice: {
    readonly rule: number
    readonly base: ChoiceCoefs
    readonly press: ChoiceCoefs
    readonly pressCentre: number
    readonly leadLane: number
    readonly inclusive: number
    readonly ivCentre: number
    readonly temperature: number
    readonly kindShift: Readonly<Record<PassAction, number>>
  }
  readonly defending: {
    readonly pressRatePerS: number
    readonly pressRadiusM: number
    readonly tackleRatePerS: number
    readonly tackleRadiusM: number
    readonly tackleBase: number
    readonly foulPerTackle: number
    readonly yellowPerFoul: number
    readonly redPerFoul: number
    /** Cautions for conduct (dissent, time-wasting) per 90 minutes, at random times (0 = none). */
    readonly cautionPerMatch: number
    /** Foul chance of an already booked defender, as a multiple of the normal one. */
    readonly bookedFoulFactor: number
    /** Booking chance for a foul by an already booked player, as a multiple of yellowPerFoul. */
    readonly bookedYellowFactor: number
    /** Share of won tackles / ground interceptions that knock the ball loose instead of winning it cleanly. */
    readonly tackleLooseShare: number
    readonly interceptLooseShare: number
    /** Extra pressing and tackling near a team's own goal: rates scale by 1 + boxIntensity x danger (0..1 within 30 m). */
    readonly boxIntensity: number
    /** Foul probability multiplier when the fouled player is inside the opponent's penalty area (defenders are careful there). */
    readonly boxFoulFactor: number
    /** Keeper comes off the line to close down a ball carrier within this distance of goal (m). */
    readonly keeperRushM: number
    /** Chance that a defender within crossBlockM of the crosser blocks the cross; share of blocks deflected behind. */
    readonly crossBlock: number
    readonly crossBlockM: number
    readonly crossBlockBehind: number
    /** Share of high balls won by defenders in their own third that are headed away (else controlled); share of those within 20 m of their goal line glanced behind. */
    readonly headClearShare: number
    readonly headBehind: number
    /** Share of clearances from wide positions kicked into touch on purpose. */
    readonly clearToTouch: number
    /** Share of clearances from inside a team's own box that are sliced behind for a corner (a defensive slip). */
    readonly clearSliceBehind: number
  }
  /**
   * D3 (P3): a wide carrier in the final third also aims crosses at zones, each offered if an attacker can be there when
   * the ball arrives (flight at flightSpeed, run at runSpeed, plus arriveSlackS) and worth attackerValue per such attacker.
   * rule 0: crosses only to teammates' positions.
   */
  readonly cross: { readonly rule: number; readonly zones: ReadonlyArray<CrossZone>; readonly flightSpeed: number; readonly runSpeed: number; readonly arriveSlackS: number; readonly attackerValue: number }
  /**
   * Keepers coming for high balls: reach (m) and depth from the goal line (m), how often they come, catch vs punch vs fumble;
   * and the share of balls running out over their own goal line they let go for a goal kick instead of collecting.
   */
  readonly keeper: {
    readonly letRunShare: number
    readonly claimRangeM: number
    readonly claimDepthM: number
    readonly comeShare: number
    readonly catchBase: number
    readonly catchHandling: number
    readonly fumbleShare: number
    /** 1: a keeper has the ball in his hands (held saves, claims, balls an opponent or he himself touched last, in his own box) or at his feet (back passes and balls a teammate touched last); 0: the old rule (every keeper possession is held for timing.keeperHoldS, and he cannot be tackled in his box). */
    readonly handsRule: number
    /** How long a keeper holds the ball in his hands, drawn uniformly (s); once he has walked to his release spot (14 m out) he lets it go after the shortest hold. */
    readonly handsHoldS: readonly [number, number]
    /** Multiplier on the press rate against a keeper with the ball at his feet. */
    readonly feetPressFactor: number
  }
  /**
   * G5 (P3): in open play a keeper with the ball in his hands throws (4..throwMaxM, error x throwErrorScale) or punts to a
   * forward (puntMinM..puntMaxM, high, error x puntErrorScale), punting with chance sigmoid(puntLogit). rule 0: from his feet.
   */
  readonly distribution: { readonly rule: number; readonly throwMaxM: number; readonly throwErrorScale: number; readonly puntMinM: number; readonly puntMaxM: number; readonly puntErrorScale: number; readonly puntLogit: number }
  readonly takeOn: { readonly b0: number; readonly bSkill: number; readonly bPressure: number }
  /**
   * Carries: speed and duration; opponents ahead within avoidM bend the heading away (0 = off); a holding carrier with an
   * opponent within shieldM moves away from them at shieldSpeed instead of standing still (0 = off).
   */
  /** On the ball: a carry's speed and length; shielding within shieldM of an opponent; otherwise walking the ball into space at holdSpeed (keepers to the edge of their box). */
  readonly carry: { readonly speed: number; readonly durationS: readonly [number, number]; readonly avoidM: number; readonly shieldM: number; readonly shieldSpeed: number; readonly holdSpeed: number }
  readonly runs: { readonly runInBehindRatePerS: number }
  /** D4 (P3): a teammate on a run gets the ball into the space where he will be when it arrives (at most leadMaxM along his run); nobody else gets a through target. rule 0: the old 8 m lead for anyone near the last defender. */
  readonly through: { readonly rule: number; readonly ballSpeed: number; readonly runSpeed: number; readonly leadMaxM: number }
  /**
   * Support play: the `count` outfielders nearest the carrier offer an angle `distM` away, at `speedShare` of top speed (count 0 = off).
   * rule 1 (P3 Task 10d): `count` come short only while the carrier is pressed (calmCount otherwise): an opponent within
   * pressM (released when none is within pressExitM), judged once per tick, each decision held at least gateHoldS;
   * their spot is on the distM circle, and every other teammate's target stays at least spaceM from an outfield carrier
   * (easing to spaceAttM in the attacking third; 0 = no spacing), never pushed past the forward-line cap (positioning.lineCapM
   * below the last defender). rule 0: the 2-nearest softmax spot at every moment of possession, no spacing.
   */
  readonly support: { readonly count: number; readonly distM: number; readonly speedShare: number; readonly rule: number; readonly pressM: number; readonly calmCount: number; readonly spaceM: number; readonly spaceAttM: number; readonly pressExitM: number; readonly gateHoldS: number }
  /** Marking: defenders pair with the nearest attacker within radiusM of their anchor and move `weight` of the way to goalSideM goal-side of them (weight 0 = off). */
  readonly marking: {
    readonly weight: number; readonly radiusM: number; readonly goalSideM: number; /** metres a marker may follow an attacker outside its own anchor's width */ readonly widthSlackM: number
    /**
     * A5 zonal marking (realism v2 P4): rule 1 moves the marker toward a lane spot laneShare of the way from the ball to the
     * attacker; a CB marking a dropping ST or AM (moving toward his own goal faster than dropMps) follows him goal-side
     * while he is at most cbStepM upfield of the CB's anchor. rule 0: the old behaviour (goal-side marking).
     */
    readonly rule: number; readonly laneShare: number; readonly cbStepM: number; readonly dropMps: number
  }
  /** Share of top speed players use when moving back into shape (calibration knob for speeds and distance). */
  /**
   * Movement into shape. shapeSpeedShare: share of top speed (the old rule, and marking); read only when relaxed is 0 (it has no effect with relaxed 1 and relaxMarks 1, so it has no tuner knob). relaxed 1 (A0): shape movement
   * heads for the spot at the speed that arrives in relaxArriveS, never above relaxCap of top speed, so a player near his
   * spot walks; relaxMarks 1 does the same for marking.
   */
  readonly movement: { readonly shapeSpeedShare: number; readonly relaxed: number; readonly relaxCap: number; readonly relaxArriveS: number; readonly relaxMarks: number }
  /** Team shape spread: width (fully in possession, partly without), depth between lines, and without the ball an extra depth squeeze. */
  readonly shape: { readonly width: number; readonly depth: number; readonly defDepth: number }
  /**
   * Off-ball positioning (realism v2, P2). rule 0: the old template (shape.ts); 1: the per-role rule table fitted to real
   * tracking, blended between rows after a change of possession, read against the ball ballLagS ago, plus team-common and
   * per-player drift (drift RNG stream). Team frame: u along the attack (m), y toward the team's left when attacking.
   */
  readonly positioning: {
    readonly rule: number
    readonly roles: Readonly<Record<PosGroup, Readonly<Record<ShapeRow, PosRow>>>>
    /** Lateral w0 for the 4-3-3's two side central midfielders (m); the real pivot row does not fit them. */
    readonly eightW0: number
    /** While the ball is within keeperNearInM of his goal, the keeper stands keeperLineM off his line, on the goal-ball line (m). */
    readonly keeperLineM: number
    /** The keeper's spot moves linearly from his line spot (ball within keeperNearInM of his goal) to his row (beyond keeperNearOutM), m. */
    readonly keeperNearInM: number
    readonly keeperNearOutM: number
    /**
     * A new side in possession must keep the ball this long (s) before the rows switch; restarts and keeper catches switch
     * at once. It is rounded to whole ticks, so 0, or anything below dt/2 (0.05 s at 10 Hz), means no debounce.
     */
    readonly commitS: number
    /** 1: a clearance in flight keeps the rows, like a loose ball (a deflection always does); 0: it counts for the clearing side. */
    readonly clearanceLoose: number
    /** Out of possession only: metres the block moves per unit of lineHeight above the league mean (0.125). */
    readonly styleLineM: number
    /** Out of possession only: share w0 shrinks per unit of compactness above the league mean (0.625). */
    readonly styleCompact: number
    /** With the ball, forwards (ST, W, AM) keep this far below the opponents' last outfield defender (m). */
    readonly lineCapM: number
    /**
     * While the other team's keeper has the ball, out-of-possession row spots are capped at this u (m), eased in and out
     * at the group's tau. The cap applies before drift, so the team and player drift can carry an anchor a little past it.
     */
    readonly vsKeeperCapU: number
    /** Phase-switch time constant by group (s): lambda = 1 - exp(-max(0, t + 0.5) / tau). */
    readonly tauS: Readonly<Record<PosGroup, number>>
    /** Lateral blend: narrowing after a loss (tau, s); spreading after a win (dead time, then tau, s). */
    readonly narrowTauS: number
    readonly spreadDeadS: number
    readonly spreadTauS: number
    /** Anchors read the ball this many seconds ago. */
    readonly ballLagS: number
    /**
     * Depth time constant (s) of every group's blend into the gk row (the own keeper has the ball; 0: the group's tauS).
     * A keeper's catch gives the team time, so it pushes up faster than after an open-play change of possession (G4).
     */
    readonly gkTauS: number
    /** Drift (A3): stationary SDs (m) and time constants (s) of OU processes, and SDs of match offsets drawn once per player. */
    readonly drift: {
      readonly teamUSdM: number
      readonly teamUTauS: number
      readonly teamYSdM: number
      readonly teamYTauS: number
      readonly playerUSdM: number
      readonly playerUTauS: number
      readonly playerSSdM: Readonly<Record<PosGroup, number>>
      readonly playerSTauS: Readonly<Record<PosGroup, number>>
      readonly offsetUSdM: Readonly<Record<PosGroup, number>>
      readonly offsetSSdM: Readonly<Record<PosGroup, number>>
      /**
       * Smoothing time constant (s) of every drift OU (Task 7d): each is a raw OU through a first-order low-pass, rescaled
       * so the stated SD and time constant hold, so the drift moves smoothly instead of a Brownian-rough step each tick.
       */
      readonly smoothS: number
      /**
       * Share of time every drift process advances while the ball is dead (a restart being set up): 1 drifts as in open
       * play, 0 freezes the drift until play restarts. The fitted drift is open-play motion; at full rate it ran 210 m/min
       * through dead balls (real 65).
       */
      readonly deadRate: number
      /**
       * Share of their own depth drift (match offsets and slow drift, not the team's shift) that back-line players (CB,
       * FB, WB) keep without the ball, by the blend's out share: a defending back line holds a flat line (real depth SD of
       * the back four 2.8-4.6 m out of possession, 6.9-10 m with the ball). 1 keeps it all.
       */
      readonly backLineOutU: number
      /**
       * Share of their own lateral drift (match offsets and slow drift, not the team's shift) that outfielders keep without
       * the ball, by the blend's out share: a defending block stays compact across the pitch (width out of possession
       * 38.96 m at 1 against real 37.0). 1 keeps it all.
       */
      readonly outS: number
    }
  }
  /**
   * Energy (1 fresh .. 0 exhausted) drains per second by (drainBase + drainSpeed2 x speed^2) x (1 + staminaSlope x (0.5 - stamina));
   * players recover halfTimeRecovery at the break; tiredness widens execution error by up to executionK.
   * tiring 1 (F1): new pressing and run triggers scale by (0.8 + 0.2 energy) and by a recent-load damping: high-intensity
   * metres (at hiSpeedMs or faster) over an exponential window of loadWindowS; past loadFreeM the factor falls by loadDamp
   * per loadFreeM, never below loadFloor.
   */
  readonly fatigue: {
    readonly drainBase: number; readonly drainSpeed2: number; readonly staminaSlope: number; readonly halfTimeRecovery: number; readonly executionK: number
    readonly tiring: number; readonly hiSpeedMs: number; readonly loadWindowS: number; readonly loadFreeM: number; readonly loadDamp: number; readonly loadFloor: number
  }
  /** Substitution policy: planned windows (match minute, mean and SD), players per window, chance of a half-time change. */
  /**
   * First touch on a reception: P(error) = sigmoid(b0 + bSpeed x (speed - 12) / 10 + bHigh x height share + bPressure x pressure + bSkill x (skill - 0.6));
   * errors split into missed, miscontrol and (the rest) heavy.
   */
  readonly firstTouch: { readonly b0: number; readonly bSpeed: number; readonly bHigh: number; readonly bPressure: number; readonly bSkill: number; readonly missedShare: number; readonly miscontrolShare: number }
  /** Loose balls two opponents can both reach are decided by a ground duel: logit = bSkill x skill difference + bReach x reach advantage (m). */
  readonly groundDuel: { readonly bSkill: number; readonly bReach: number; readonly contestM: number }
  /**
   * T2 tackle success (realism v2 P4): logit = base + 3 (tackling - dribbling) + approach (frontLogit under frontDeg,
   * behindLogit at behindDeg or more, bearing from the carrier's velocity, his attack direction below headingMinMps)
   * + supportLogit min(n, supportMax) (defending outfielders within supportM of the carrier) + speedLogit |carrier v|
   * + boxLogit in the box he attacks. rule 0: the old behaviour (defending.tackleBase + 3 (tackling - dribbling)).
   */
  readonly tackle: {
    readonly rule: number; readonly base: number; readonly frontLogit: number; readonly behindLogit: number; readonly frontDeg: number; readonly behindDeg: number
    readonly supportLogit: number; readonly supportM: number; readonly supportMax: number; readonly speedLogit: number; readonly boxLogit: number; readonly headingMinMps: number
  }
  /**
   * T3/T4 fouls (realism v2 P4): the foul chance on a lost tackle is foulPerTackle x zone (1 in his own half, linear to
   * finalThird at u = finalThirdU, box in the box he attacks) x angle (front 1, side, behind); attackers foul a tackler
   * (attackerShare, carrier slower than shieldSpeedMax) and beaten defenders foul on a take-on (takeOnShare).
   * rule 0: the old behaviour (flat rate, box x defending.boxFoulFactor, no attacker or take-on fouls).
   */
  readonly fouls: {
    readonly rule: number; readonly finalThirdU: number; readonly finalThird: number; readonly box: number; readonly side: number; readonly behind: number
    readonly attackerShare: number; readonly shieldSpeedMax: number; readonly takeOnShare: number
  }
  /**
   * T4 aerial duels (realism v2 P4): the best opponent within contestM of an aerial contact contests it; the winner is
   * drawn with sigmoid(bHeading dHeading + bSlack dSlack); the loser fouls the winner with chance foulShare x zone.
   * rule 0: the old behaviour (resolveFlight's draw, no aerial fouls).
   */
  readonly aerial: { readonly rule: number; readonly contestM: number; readonly bHeading: number; readonly bSlack: number; readonly foulShare: number }
  /**
   * A4 transitions (realism v2 P4): after a live-play loss, losing outfielders counter-press for windowS with chance
   * joinP[i] by distance to the ball (under joinM[i]) at speed; others hold course for pauseS (pauseShare of top speed,
   * beyond pauseRadiusM) and run back (recover) from recoverFromS to recoverToS at a ramped hazard recoverRatePerS.
   * rule 0: the old behaviour (no transition state).
   */
  readonly transition: {
    readonly rule: number; readonly windowS: number; readonly joinM: ReadonlyArray<number>; readonly joinP: ReadonlyArray<number>; readonly speed: number
    readonly pauseS: number; readonly pauseShare: number; readonly pauseRadiusM: number
    readonly recoverFromS: number; readonly recoverPeakS: readonly [number, number]; readonly recoverToS: number; readonly recoverRatePerS: number
    readonly recoverBehindFactor: number; readonly recoverUpfieldM: number; readonly recoverS: readonly [number, number]; readonly recoverSpeedShare: number
  }
  /**
   * A5 team pressing (realism v2 P4): the press hazard is scaled by rateScale and lifted by backToGoalLift (a carrier who
   * received a forward pass faster than backToGoalBallMps at most backToGoalS ago) and ownThirdLift (ball below
   * -ownThirdU); the presser is chosen by distance / roleWeight; a second presser (within secondRadiusM, chance
   * secondShare) joins a first one within secondM, taking the cover shadow shadowM from the carrier.
   * rule 0: the old behaviour (the nearest defender presses at the even hazard).
   */
  readonly press: {
    readonly rule: number; readonly rateScale: number; readonly backToGoalLift: number; readonly backToGoalS: number; readonly backToGoalBallMps: number
    readonly ownThirdLift: number; readonly ownThirdU: number; readonly roleWeight: Readonly<Record<Exclude<Role, "GK">, number>>
    readonly secondM: number; readonly secondRadiusM: number; readonly secondShare: number; readonly shadowM: number
  }
  /**
   * Game state on scoring: a multiplier per 15-minute bin (mean 1; the last bin includes added time), and the
   * red-card factors for the team down to fewer players and for its opponent.
   */
  readonly gameState: { readonly minuteProfile: readonly [number, number, number, number, number, number]; readonly redCardOwn: number; readonly redCardOpponent: number }
  /**
   * Scenario-script nudges (see script.ts): logit shifts and multipliers applied to the scripted team inside an
   * entry's window — goal: shot logit and scoring; momentum: attacking logits and pressing; press surge: pressing
   * and tackling; red card: fouls and reds; keeper heroics or howler: save logit and fumbles; defensive error: mis-hits.
   */
  readonly script: {
    readonly goalShotLogit: number
    readonly goalScoring: number
    /** A team's normal goals per minute, and the cap on the scoring multiplier, for scaling goal nudges. */
    readonly goalRatePerMin: number
    readonly goalScoringMax: number
    /** Lowest multiplier a goal nudge applies to the team's shooting error. */
    readonly goalAimMin: number
    /** A press surge counts as achieved at this many pressures per 100 opponent passes in its window. */
    readonly pressTarget: number
    readonly momentumLogit: number
    readonly momentumPress: number
    readonly pressSurge: number
    readonly pressTackle: number
    readonly redFoul: number
    readonly redCard: number
    readonly heroicsSave: number
    readonly howlerSave: number
    readonly howlerFumble: number
    readonly errorMishit: number
    /** Added to the shot logit (half of it to attacking passes) while a forced goal is pending, so the forced outcome gets its qualifying action. */
    readonly forcedShotLogit: number
  }
  readonly substitutions: {
    readonly windowMinutes: readonly [number, number, number]
    readonly windowSdMin: number
    readonly perWindow: readonly [number, number, number]
    /** Chance that each planned window is used. */
    readonly windowChance: readonly [number, number, number]
    readonly halfTimeChance: number
    /** Weight on each outfield role's claim to come off (score x weight); all 1 keeps the old choice. */
    readonly roleWeights: Readonly<Record<Exclude<Role, "GK">, number>>
  }
  readonly classifier: ClassifierThresholds
}

const pr = (a: number, b: number, w0: number, w1: number, w2: number, w3: number, e: number): PosRow => ({ a, b, w0, w1, w2, w3, e })

const row = (o: Partial<Record<Action, number>>): Record<Action, number> => {
  const out = {} as Record<Action, number>
  for (const a of ACTIONS) out[a] = o[a] ?? -4
  return out
}

/**
 * Hand-set priors so the engine runs before the offline fit (Plan 2) replaces them.
 * Values are order-of-magnitude guesses, not fitted.
 */
export const DEFAULT_PARAMS: Params = {
  provenance: {
    dataset: "none (hand-set priors)",
    licence: "hand-set-prior",
    attribution: "Touchline authors",
    fitted_at: "2026-10-03",
    version: "prior-1"
  },
  kinematics: { accelMax: 4.5, reactionS: 0.7, reachM: 1.0, reachMargin: 0.75, controlHeightM: 1.0, headerHeightM: 2.4 },
  // P3 X1 (rule 1 ships; the values are the calibrated ones).
  firstTick: {
    rule: 1, alongM: 0.5, coneDeg: 60, bootM: 1, bootBlock: 0.1,
    // P4 M5 (spec item M5; rule 0: the old behaviour).
    scopeRule: 0
  },
  ball: { gravity: 9.81, substeps: 4 },
  physics: {
    ball: { drag: 0.013, restitution: 0.62, bounceFriction: 0.6, skidFriction: 0.3, rollC0: 0.5, rollC1: 0.15 },
    players: {
      a0: { GK: [7.6, 8, 8.5, 9, 9.4], DEF: [7.6, 8, 8.5, 9, 9.4], MID: [7.6, 8, 8.5, 9, 9.4], FWD: [7.6, 8, 8.5, 9, 9.4] },
      s0: { GK: [8.4, 8.8, 9.3, 9.6, 10], DEF: [8.4, 8.8, 9.3, 9.6, 10], MID: [8.4, 8.8, 9.3, 9.6, 10], FWD: [8.4, 8.8, 9.3, 9.6, 10] },
      paceKnots: [0.43, 0.52, 0.59, 0.66, 0.77],
      accelerationKnots: [0.48, 0.52, 0.57, 0.61, 0.65],
      brake: 7,
      lateral: 6,
      reactionS: 0.3
    }
  },
  timing: {
    decisionMinS: 0.9,
    decisionMaxS: 2.2,
    keeperHoldS: 4,
    restartDelayS: { kickoff: 45, throw_in: 18, corner: 37, goal_kick: 30, free_kick: 25, penalty: 60 },
    addedTimeMinS: [60, 300]
  },
  // P3 D2 (rule 1 ships; the values are the calibrated ones).
  release: {
    rule: 1, pressedM: 2, pressedS: [0.2, 0.7], tailShare: 0.35, tailMeanS: 2.5,
    // P4 M6 (spec item M6; capS 0 and rejudge 0: the old behaviour).
    capS: 0,
    rejudge: 0
  },
  actions: {
    logits: {
      def_wide: row({ short_pass: 1.6, long_pass: 0.4, switch: -0.6, back_pass: -0.1, carry: 0.5, take_on: -1.2, clear: -0.4, hold: -0.6 }),
      def_central: row({ short_pass: 1.8, long_pass: 0.5, switch: -0.4, back_pass: -0.2, carry: 0.4, take_on: -1.5, clear: -0.2, hold: -0.6 }),
      mid_wide: row({ short_pass: 1.7, long_pass: 0.0, through_ball: -0.6, lofted_through: -1.0, switch: -0.5, cross: -1.2, back_pass: -0.3, carry: 0.7, take_on: -0.4, hold: -0.6 }),
      mid_central: row({ short_pass: 1.9, long_pass: -0.1, through_ball: -0.3, lofted_through: -0.9, switch: -0.4, back_pass: -0.2, carry: 0.6, take_on: -0.6, shot: -3.0, hold: -0.6 }),
      att_wide: row({ short_pass: 1.3, long_pass: -1.0, through_ball: -0.4, lofted_through: -1.0, cross: 0.6, cutback: -0.2, back_pass: -0.2, carry: 0.6, take_on: 0.0, shot: -2.0, hold: -0.4 }),
      att_central: row({ short_pass: 1.4, long_pass: -1.2, through_ball: 0.1, lofted_through: -0.6, back_pass: -0.3, carry: 0.6, take_on: -0.2, shot: -1.2, hold: -0.5 }),
      box: row({ short_pass: 0.6, through_ball: -0.4, cutback: 0.4, back_pass: -0.7, carry: 0.2, take_on: 0.1, shot: 0.3, clear: -2.0, hold: -0.8 })
    },
    styleWeight: 1.0,
    pressureWeight: 1.0,
    holdDecayPerS: 1.5
  },
  pass: {
    xpass: { b0: 3.24, bDist: -0.08, bLane: -1.0, bPressure: -0.8, bHigh: -0.4 },
    arriveSpeed: 7,
    highLaunchDeg: 30,
    throughLeadM: 8,
    choiceTemperature: 0.35,
    pitchControlWeight: 0,
    safetyWeight: 0,
    // P3 X2 (0 ships: the distance-error knob is not tuned).
    longErrorPerM: 0, longErrorFromM: 30
  },
  execution: { dirSigma: 0.035, distSigma: 0.07, pressureK: 1.6, weakFootK: 1.45, mishitBase: 0.006, mishitK: 0.11 },
  shot: {
    // Fitted to an approximate public reference xG curve (central and off-centre open-play shots, 2-30 m); a prior, not data-derived.
    xg: { b0: -1.25, bDist: -0.08, bAngle: 1.2, bHeader: -1.0, bDefenders: -0.3 },
    maxDistanceM: 32,
    speed: 26,
    onTargetRate: 0.38,
    aimNoise: 1.0,
    // Set so that about 23 % of shots are blocked, as in the IDSSE matches (39 of 171 shots).
    blockPerDefender: 0.23,
    blockWidthM: 3.5,
    blockPressure: 0.2,
    blockBehind: 0.5,
    // A prior shaped like public post-shot xG findings (corners and close range beat keepers); the intercept is tuned to the IDSSE save rate.
    save: { b0: 1.3, bWide: -1.6, bEdge: -0.7, bDistance: 0.6, bReflexes: 2.0 }
  },
  // P3 D1 (rule 1 ships; the values are the calibrated ones). Real pooled fit (carrier-report C3, all passes, IDSSE 7 matches)
  // and the change per unit of pressure about the real mean pressure at release (0.366).
  choice: {
    rule: 1,
    base: { dist: -1.33, fwd: 0.56, lat: 0.18, lane: -0.55, open: 1.27, lineBreak: 0.04, keeper: 0.95 },
    press: { dist: 0, fwd: 0.22, lat: -0.46, lane: 0, open: -0.58, lineBreak: -0.58, keeper: 0.98 },
    pressCentre: 0.366,
    leadLane: 0,
    inclusive: 1,
    // Task 9 (X1 on, seeds 2000-2015): ivCentre 1 keeps passes per match at the X1-only level (1047 vs 1048); switch 0
    // already gives a switch share of 0.052 (real 0.061). No long shift: +0.5 moved the 32 m+ share only 0.049 -> 0.054
    // (real 0.143), and +3 reaches 0.105 at the cost of the refit (distance -0.75) and the ball's depth (own third 0.200).
    // Task 10 (all P3 on, 16 matches): through_ball 0 / -0.5 / -1 / -1.5 gave shots after a through ball 0.119 / 0.141 /
    // 0.077 / 0.043 (real 0.025, band to 0.05) with own third 0.244 / 0.226 / 0.238 / 0.230 and passes 872-882: -1.5.
    ivCentre: 1,
    temperature: 1,
    kindShift: { short_pass: 0, long_pass: 0, through_ball: -1.5, lofted_through: 0, switch: 0, cross: 0, cutback: 0, back_pass: 0 }
  },
  defending: {
    pressRatePerS: 0.6,
    pressRadiusM: 3,
    tackleRatePerS: 0.35,
    tackleRadiusM: 1.6,
    tackleBase: 0.0,
    foulPerTackle: 0.18,
    yellowPerFoul: 0.15,
    redPerFoul: 0.004,
    cautionPerMatch: 1.7,
    bookedFoulFactor: 0.5,
    bookedYellowFactor: 0.6,
    tackleLooseShare: 0.4,
    interceptLooseShare: 0.3,
    boxIntensity: 0,
    boxFoulFactor: 0.2,
    keeperRushM: 12,
    crossBlock: 0.6,
    crossBlockM: 4.0,
    crossBlockBehind: 0.6,
    headClearShare: 0.85,
    headBehind: 0.35,
    clearToTouch: 0.2,
    clearSliceBehind: 0.2
  },
  // P3 D3 (rule 1 ships; the values are the calibrated ones). Zones in the team frame; s toward the crosser's touchline.
  cross: {
    rule: 1,
    zones: [
      { u: 47.5, s: 3, height: "high", minOriginU: 0 },
      { u: 41.5, s: 0, height: "high", minOriginU: 0 },
      { u: 47, s: -4, height: "high", minOriginU: 0 },
      { u: 42, s: 6, height: "ground", minOriginU: 44 }
    ],
    flightSpeed: 18,
    runSpeed: 7,
    arriveSlackS: 0.6,
    attackerValue: 0.6
  },
  keeper: { letRunShare: 0.85, claimRangeM: 11, claimDepthM: 13, comeShare: 0.85, catchBase: 0.4, catchHandling: 0.35, fumbleShare: 0.06, handsRule: 1, handsHoldS: [5, 10], feetPressFactor: 0.25 },
  // P3 G5 (rule 1 ships; the values are the calibrated ones). Real: 3.4 throws and 1.6 punts per team-match (gk-report).
  distribution: { rule: 1, throwMaxM: 35, throwErrorScale: 0.5, puntMinM: 35, puntMaxM: 70, puntErrorScale: 1.6, puntLogit: -0.25 },
  takeOn: { b0: -0.2, bSkill: 3.0, bPressure: -0.8 },
  carry: { speed: 5.5, durationS: [0.8, 2.0], avoidM: 6, shieldM: 3, shieldSpeed: 1.5, holdSpeed: 1.4 },
  runs: { runInBehindRatePerS: 0.12 },
  // P3 D4 (rule 1 ships; the values are the calibrated ones).
  through: { rule: 1, ballSpeed: 14, runSpeed: 7, leadMaxM: 15 },
  // P3 Task 10d. Real nearest non-carrier teammates in possession 8.9 / 13.3 / 17.2 m (offball-report T14); pressM is
  // the carrier-report pressure bucket (5 m). Real teams crowd the ball more in the attacking third (nearest-3 mean
  // 7.1-8.9 m there against 10.5-13.0 m in the defensive third, fit-report section 3), hence spaceAttM < spaceM.
  support: { count: 2, distM: 12, speedShare: 0.8, rule: 1, pressM: 5, calmCount: 0, spaceM: 16, spaceAttM: 11, pressExitM: 5, gateHoldS: 1 },
  marking: {
    weight: 0.5, radiusM: 15, goalSideM: 1.5, widthSlackM: 4,
    // P4 A5 zonal marking (spec item A5; rule 0: the old behaviour).
    rule: 0, laneShare: 0.4, cbStepM: 10, dropMps: 1
  },
  movement: { shapeSpeedShare: 0.7, relaxed: 1, relaxCap: 0.6, relaxArriveS: 2, relaxMarks: 1 },
  shape: { width: 1, depth: 1, defDepth: 1 },
  // Real fits (IDSSE, 7 matches; fit-report.md, offball-report.md, transitions-report.md, gk-report.md, 2026-10-13).
  // in / out rows: the spec's table (a, b) and fit-report section 4 (lateral); gk rows: the build-up shape (gk-report).
  positioning: {
    rule: 1,
    roles: {
      GK: { in: pr(-31.6, 0.31, 0, 0, 0, 0, 0.18), out: pr(-42.0, 0.25, 0, 0, 0, 0, 0.11), gk: pr(-31.6, 0.31, 0, 0, 0, 0, 0.18) },
      CB: { in: pr(-8.6, 0.64, 10.9, -0.11, 0.32, 0.01, 0.39), out: pr(-22.5, 0.46, 5.3, 0.04, 0.37, 0.02, 0.37), gk: pr(-30.5, 0, 15.5, 0, 0, 0, 0) },
      FB: { in: pr(4.6, 0.59, 23.3, -0.12, 0.24, -0.12, 0), out: pr(-19.5, 0.48, 9.9, 0.08, 0.34, 0.1, 0), gk: pr(-13, 0, 27, 0, 0, 0, 0) },
      WB: { in: pr(8.7, 0.59, 24.9, -0.15, 0.2, -0.04, 0), out: pr(-18.0, 0.51, 17.6, 0.09, 0.29, 0.01, 0), gk: pr(-15.9, 0, 27, 0, 0, 0, 0) },
      CM: { in: pr(5.3, 0.61, 3.5, -0.03, 0.45, -0.01, 0.45), out: pr(-12.7, 0.56, 3.4, 0.01, 0.47, -0.01, 0.5), gk: pr(-15.5, 0, 2.7, 0, 0, 0, 0) },
      AM: { in: pr(13.2, 0.57, 0, 0, 0, 0, 0.38), out: pr(-4.5, 0.62, 0, 0, 0, 0, 0.47), gk: pr(-3.6, 0, 0, 0, 0, 0, 0) },
      W: { in: pr(15.4, 0.54, 14.7, -0.12, 0.32, 0.04, 0), out: pr(-8.8, 0.59, 13.2, 0.06, 0.34, 0.02, 0), gk: pr(-2.9, 0, 12.4, 0, 0, 0, 0) },
      ST: { in: pr(19.6, 0.53, 5, 0, 0.35, 0.05, 0.32), out: pr(2.7, 0.59, 5, 0.02, 0.4, 0.01, 0.4), gk: pr(4.3, 0, 5, 0, 0, 0, 0) }
    },
    eightW0: 8.5,
    keeperLineM: 2,
    keeperNearInM: 22,
    keeperNearOutM: 30,
    commitS: 0,
    clearanceLoose: 0,
    styleLineM: 3,
    styleCompact: 0.35,
    lineCapM: 4,
    vsKeeperCapU: 22,
    tauS: { GK: 2.5, CB: 3, FB: 3.5, WB: 3.5, CM: 2.75, AM: 2.75, W: 3.25, ST: 2.75 },
    narrowTauS: 1,
    spreadDeadS: 2.5,
    spreadTauS: 4.5,
    ballLagS: 2,
    gkTauS: 1.5,
    drift: {
      teamUSdM: 9,
      teamUTauS: 8,
      teamYSdM: 5.4,
      teamYTauS: 5,
      playerUSdM: 6,
      playerUTauS: 12,
      playerSSdM: { GK: 0, CB: 5.7, FB: 9, WB: 9, CM: 6.8, AM: 8.5, W: 9, ST: 8.7 },
      playerSTauS: { GK: 20, CB: 20, FB: 40, WB: 40, CM: 25, AM: 40, W: 40, ST: 40 },
      offsetUSdM: { GK: 0, CB: 2.4, FB: 4.8, WB: 4.8, CM: 5.0, AM: 5.9, W: 4.9, ST: 2.9 },
      offsetSSdM: { GK: 0, CB: 3.0, FB: 7.0, WB: 7.0, CM: 4.0, AM: 5.0, W: 4.9, ST: 3.0 },
      smoothS: 3,
      deadRate: 0.25,
      backLineOutU: 0.25,
      outS: 0.5
    }
  },
  fatigue: { drainBase: 0.00004, drainSpeed2: 0.000012, staminaSlope: 0.8, halfTimeRecovery: 0.1, executionK: 0.25, tiring: 1, hiSpeedMs: 5.56, loadWindowS: 300, loadFreeM: 45, loadDamp: 0.5, loadFloor: 0.5 },
  firstTouch: { b0: -3.9, bSpeed: 1.0, bHigh: 1.2, bPressure: 1.5, bSkill: -3.5, missedShare: 0.15, miscontrolShare: 0.35 },
  groundDuel: { bSkill: 3, bReach: 2, contestM: 0.6 },
  // P4 T2 tackle success (spec item T2; rule 0: the old behaviour).
  tackle: { rule: 0, base: 0, frontLogit: 0.35, behindLogit: -0.35, frontDeg: 60, behindDeg: 120, supportLogit: 0.4, supportM: 5, supportMax: 2, speedLogit: -0.1, boxLogit: 0.3, headingMinMps: 1 },
  // P4 T3/T4 fouls (spec items T3, T4; rule 0: the old behaviour).
  fouls: { rule: 0, finalThirdU: 17.5, finalThird: 0.4, box: 0.12, side: 1.6, behind: 2.4, attackerShare: 0.05, shieldSpeedMax: 2, takeOnShare: 0.15 },
  // P4 T4 aerial duels (spec item T4; rule 0: the old behaviour).
  aerial: { rule: 0, contestM: 1, bHeading: 3, bSlack: 1, foulShare: 0.13 },
  // P4 A4 transitions (spec item A4; rule 0: the old behaviour).
  transition: {
    rule: 0, windowS: 3, joinM: [5, 10, 15, 20, 30], joinP: [0.8, 0.3, 0.23, 0.13, 0.07], speed: 4.5, pauseS: 1.5, pauseShare: 0.55, pauseRadiusM: 10,
    recoverFromS: 2.5, recoverPeakS: [5, 6], recoverToS: 8, recoverRatePerS: 0.05, recoverBehindFactor: 0.33, recoverUpfieldM: -10, recoverS: [1.5, 3], recoverSpeedShare: 0.9
  },
  // P4 A5 team pressing (spec item A5; rule 0: the old behaviour).
  press: {
    rule: 0, rateScale: 1, backToGoalLift: 2, backToGoalS: 1.5, backToGoalBallMps: 5, ownThirdLift: 2, ownThirdU: 17.5,
    roleWeight: { CB: 0.6, FB: 0.9, DM: 1, CM: 1, AM: 0.8, W: 1, ST: 0.7 }, secondM: 12, secondRadiusM: 15, secondShare: 0.45, shadowM: 4
  },
  // Hand-set prior with more goals late (refit from Wyscout goal minutes when that data is available); red-card factors from the spec.
  gameState: { minuteProfile: [0.85, 0.95, 1.05, 0.95, 1.05, 1.15], redCardOwn: 0.67, redCardOpponent: 1.2 },
  script: {
    goalShotLogit: 2, goalScoring: 2.0, goalRatePerMin: 0.016, goalScoringMax: 6, goalAimMin: 0.6, pressTarget: 55,
    momentumLogit: 1.0, momentumPress: 1.3, pressSurge: 4, pressTackle: 2, redFoul: 2, redCard: 125, heroicsSave: 1.5, howlerSave: 1.5, howlerFumble: 0.3, errorMishit: 8, forcedShotLogit: 5
  },
  // About four changes per team on average (Bundesliga teams make roughly 4-4.5 of their 5).
  substitutions: { windowMinutes: [64, 75, 84], windowSdMin: 5, perWindow: [2, 2, 1], windowChance: [1, 0.8, 0.5], halfTimeChance: 0.2, roleWeights: { CB: 0.15, FB: 0.4, DM: 0.7, CM: 0.7, AM: 0.9, W: 1, ST: 0.9 } },
  classifier: {
    longPassM: 32,
    switchLateralM: 25,
    backPassM: 5,
    carryMinM: 3,
    crossOriginAbsY: 20.16,
    finalThirdAttackX: 17.5,
    cutbackOriginAttackX: 41,
    cutbackTargetAttackXMin: 41.5,
    cutbackTargetAttackXMax: 47,
    cutbackTargetAbsY: 11
  }
}

export class ParamsError extends Error {}

/** Reject parameter files whose provenance licence is not on the allowed list. */
export const assertProvenance = (p: { provenance?: Partial<Provenance> }): void => {
  const pv = p.provenance
  if (!pv || !pv.dataset || !pv.licence || !pv.version) throw new ParamsError("params file is missing provenance")
  if (!(ALLOWED_LICENCES as ReadonlyArray<string>).includes(pv.licence))
    throw new ParamsError(`licence "${pv.licence}" is not allowed (allowed: ${ALLOWED_LICENCES.join(", ")})`)
  if (pv.licence !== "hand-set-prior" && (!pv.attribution || !pv.fitted_at))
    throw new ParamsError(`licence "${pv.licence}" requires provenance attribution and fitted_at`)
  if (/statsbomb/i.test(`${pv.dataset} ${pv.attribution ?? ""}`)) throw new ParamsError("StatsBomb-derived parameters are not allowed")
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)

/** Merge `over` onto `base`, keeping only keys `base` owns; every value must have its default's type. */
const mergeInto = (base: unknown, over: unknown, path: string): unknown => {
  if (over === undefined) return base
  const bad = (): never => {
    throw new ParamsError(`params field ${path} has the wrong type (expected ${Array.isArray(base) ? `array of ${(base as unknown[]).length}` : typeof base})`)
  }
  if (Array.isArray(base)) {
    if (!Array.isArray(over) || over.length !== base.length) bad()
    return base.map((b, i) => mergeInto(b, (over as unknown[])[i], `${path}[${i}]`))
  }
  if (isObject(base)) {
    if (!isObject(over)) bad()
    const out: Record<string, unknown> = { ...base }
    for (const [k, v] of Object.entries(over as Record<string, unknown>)) if (Object.hasOwn(base, k)) out[k] = mergeInto(base[k], v, `${path}.${k}`)
    return out
  }
  if (typeof base === "number" ? typeof over !== "number" || !Number.isFinite(over) : typeof over !== typeof base) bad()
  return over
}

/**
 * Parameters from a JSON file: the provenance gate first, then a deep merge onto DEFAULT_PARAMS
 * (fields the file omits keep their defaults; keys the engine does not know are ignored).
 */
/** Model coefficients and logits, which may take any sign. */
const SIGNED = [/^actions\.logits\./, /^pass\.xpass\./, /^shot\.xg\./, /^shot\.save\./, /^takeOn\./, /^firstTouch\.b/, /^groundDuel\.b/, /^defending\.tackleBase$/, /^positioning\.roles\./, /^choice\.(base|press|kindShift)\./, /^choice\.(leadLane|ivCentre)$/, /^cross\.zones/, /^distribution\.puntLogit$/, /^tackle\.(base|behindLogit|speedLogit)$/, /^transition\.recoverUpfieldM$/]
/** Probabilities and shares, which must lie in 0..1. */
const PROBABILITIES = new Set([
  "support.speedShare", "marking.weight",
  "kinematics.reachMargin", "physics.ball.restitution", "execution.mishitBase", "movement.shapeSpeedShare", "movement.relaxCap", "fatigue.loadFloor",
  "shot.onTargetRate", "shot.blockPerDefender", "shot.blockPressure", "shot.blockBehind",
  "defending.foulPerTackle", "defending.yellowPerFoul", "defending.redPerFoul", "defending.tackleLooseShare", "defending.interceptLooseShare",
  "defending.crossBlock", "defending.crossBlockBehind", "defending.headClearShare", "defending.headBehind", "defending.clearToTouch", "defending.clearSliceBehind",
  "keeper.letRunShare", "keeper.comeShare", "keeper.catchBase", "keeper.catchHandling", "keeper.fumbleShare",
  "firstTouch.missedShare", "firstTouch.miscontrolShare", "substitutions.windowChance", "substitutions.halfTimeChance",
  "fatigue.halfTimeRecovery", "script.howlerFumble", "pass.pitchControlWeight", "positioning.drift.deadRate", "positioning.drift.backLineOutU", "positioning.drift.outS",
  "firstTick.bootBlock", "release.tailShare",
  "transition.joinP", "transition.pauseShare", "transition.recoverSpeedShare", "press.secondShare", "fouls.attackerShare", "fouls.takeOnShare", "aerial.foulShare", "marking.laneShare"
])

/** Check every number: probabilities in 0..1, coefficients any sign, everything else not negative. */
const checkRanges = (v: unknown, path: string): void => {
  if (Array.isArray(v)) return v.forEach((x) => checkRanges(x, path))
  if (isObject(v)) return Object.entries(v).forEach(([k, x]) => checkRanges(x, path ? `${path}.${k}` : k))
  if (typeof v !== "number" || SIGNED.some((r) => r.test(path))) return
  if (PROBABILITIES.has(path) && (v < 0 || v > 1)) throw new ParamsError(`params field ${path} must be between 0 and 1 (got ${v})`)
  if (v < 0) throw new ParamsError(`params field ${path} must not be negative (got ${v})`)
}

/** Support play (P3 Task 10d): whole numbers of supporters, a known rule, a release no tighter than the trigger, attacking-third spacing no wider. */
const checkSupport = (s: Params["support"]): void => {
  for (const k of ["count", "calmCount"] as const) if (!Number.isInteger(s[k])) throw new ParamsError(`params field support.${k} must be a whole number (got ${s[k]})`)
  if (s.rule !== 0 && s.rule !== 1) throw new ParamsError(`params field support.rule must be 0 or 1 (got ${s.rule})`)
  if (s.pressExitM < s.pressM) throw new ParamsError(`params field support.pressExitM must be at least support.pressM (got ${s.pressExitM} < ${s.pressM})`)
  if (s.spaceAttM > s.spaceM) throw new ParamsError(`params field support.spaceAttM must not exceed support.spaceM (got ${s.spaceAttM} > ${s.spaceM})`)
}

/** The P3 and P4 rule switches are 0 (the old behaviour) or 1 (the new one): 0.5 is neither. */
const checkRuleSwitches = (v: Params): void => {
  const switches: ReadonlyArray<readonly [string, number]> = [
    ["firstTick.rule", v.firstTick.rule],
    ["release.rule", v.release.rule],
    ["choice.rule", v.choice.rule],
    ["cross.rule", v.cross.rule],
    ["distribution.rule", v.distribution.rule],
    ["through.rule", v.through.rule],
    ["keeper.handsRule", v.keeper.handsRule],
    ["tackle.rule", v.tackle.rule],
    ["fouls.rule", v.fouls.rule],
    ["aerial.rule", v.aerial.rule],
    ["transition.rule", v.transition.rule],
    ["press.rule", v.press.rule],
    ["marking.rule", v.marking.rule],
    ["firstTick.scopeRule", v.firstTick.scopeRule],
    ["release.rejudge", v.release.rejudge]
  ]
  for (const [path, x] of switches) if (x !== 0 && x !== 1) throw new ParamsError(`params field ${path} must be 0 or 1 (got ${x})`)
}

/** A4 join table (P4): distance bands strictly increasing, one chance per band. */
const checkTransition = (t: Params["transition"]): void => {
  if (t.joinM.length !== t.joinP.length)
    throw new ParamsError(`params field transition.joinM must have as many bands as transition.joinP (got ${t.joinM.length} and ${t.joinP.length})`)
  for (let i = 1; i < t.joinM.length; i++)
    if (!(t.joinM[i]! > t.joinM[i - 1]!)) throw new ParamsError(`params field transition.joinM must be strictly increasing (got ${t.joinM.join(", ")})`)
}

export const paramsFromJson = (json: unknown): Params => {
  if (!isObject(json)) throw new ParamsError("params file must be a JSON object")
  assertProvenance(json as { provenance?: Partial<Provenance> })
  const merged = mergeInto(DEFAULT_PARAMS, json, "params") as Params
  const { provenance: _, ...values } = merged
  checkRanges(values, "")
  checkSupport(merged.support)
  checkRuleSwitches(merged)
  checkTransition(merged.transition)
  return merged
}
