import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { ACTIONS, assertProvenance, DEFAULT_PARAMS, ParamsError, paramsFromJson } from "../src/params.js"
import { ACTION_ZONES } from "../src/geometry.js"
import { CONCERNS } from "../src/types.js"

describe("params", () => {
  it("default priors carry provenance and pass the licence check", () => {
    expect(() => assertProvenance(DEFAULT_PARAMS)).not.toThrow()
  })
  it("rejects files with no provenance, a disallowed licence, or StatsBomb data", () => {
    expect(() => assertProvenance({})).toThrow(ParamsError)
    expect(() => assertProvenance({ provenance: { ...DEFAULT_PARAMS.provenance, licence: "proprietary" } })).toThrow(/not allowed/)
    expect(() => assertProvenance({ provenance: { ...DEFAULT_PARAMS.provenance, dataset: "StatsBomb open data", licence: "CC-BY-4.0" } })).toThrow(/StatsBomb/)
  })
  it("has a logit for every action in every zone", () => {
    for (const z of ACTION_ZONES) for (const a of ACTIONS) expect(Number.isFinite(DEFAULT_PARAMS.actions.logits[z][a])).toBe(true)
  })
})

describe("params from JSON", () => {
  it("merges a partial file onto the defaults and keeps provenance", () => {
    const p = paramsFromJson({ provenance: { ...DEFAULT_PARAMS.provenance, version: "calib-x" }, kinematics: { reachMargin: 0.6 } })
    expect(p.kinematics.reachMargin).toBe(0.6)
    expect(p.kinematics.reachM).toBe(DEFAULT_PARAMS.kinematics.reachM)
    expect(p.provenance.version).toBe("calib-x")
  })
  it("ignores keys the engine does not know (e.g. the calibration record)", () => {
    const p = paramsFromJson({ provenance: DEFAULT_PARAMS.provenance, calibration: { loss: 3 } }) as unknown as Record<string, unknown>
    expect(p.calibration).toBeUndefined()
  })
  it("refuses files without an allowed licence", () => {
    expect(() => paramsFromJson({ kinematics: {} })).toThrow(ParamsError)
    expect(() => paramsFromJson({ provenance: { ...DEFAULT_PARAMS.provenance, dataset: "StatsBomb open data", licence: "CC-BY-4.0" } })).toThrow(/StatsBomb/)
    expect(() => paramsFromJson([1, 2])).toThrow(ParamsError)
  })
})

describe("params from JSON: review fixes", () => {
  const cc = { dataset: "open data", licence: "CC-BY-4.0", attribution: "Some League; Someone et al.", fitted_at: "2026-10-04", version: "v1" }
  it("refuses values whose type differs from the default's", () => {
    for (const bad of [
      { kinematics: { reachM: "far" } },
      { ball: null },
      { shot: 5 },
      { timing: { addedTimeMinS: [1] } },
      { kinematics: { reachMargin: Number.NaN } }
    ]) expect(() => paramsFromJson({ provenance: cc, ...bad }), JSON.stringify(bad)).toThrow(ParamsError)
  })
  it("requires attribution and fitting date for data-derived licences, and checks attribution for StatsBomb", () => {
    expect(() => paramsFromJson({ provenance: { ...cc, attribution: undefined } })).toThrow(/attribution/)
    expect(() => paramsFromJson({ provenance: { ...cc, fitted_at: "" } })).toThrow(/attribution/)
    expect(() => paramsFromJson({ provenance: { ...cc, attribution: "StatsBomb" } })).toThrow(/StatsBomb/)
    expect(paramsFromJson({ provenance: cc }).provenance.attribution).toBe(cc.attribution)
  })
  it("ignores inherited keys such as toString and __proto__", () => {
    const p = paramsFromJson(JSON.parse(`{"provenance":${JSON.stringify(cc)},"kinematics":{"toString":"boom","__proto__":{"x":1}}}`)) as unknown as { kinematics: object }
    expect(Object.hasOwn(p.kinematics, "toString")).toBe(false)
    expect(String(p.kinematics)).toBe("[object Object]")
  })
})

describe("params from JSON: value ranges", () => {
  const prov = { dataset: "open data", licence: "CC-BY-4.0", attribution: "Some League; Someone et al.", fitted_at: "2026-10-06", version: "v1" }
  it("labels the hand-set priors with the version that changed their scenario settings", () => {
    // Runs record the version; a run made with older priors must not be rebuilt with these.
    expect(DEFAULT_PARAMS.provenance.version).toBe("prior-1")
  })
  it("accepts the defaults and the committed calibrated parameters", () => {
    expect(() => paramsFromJson({ provenance: prov })).not.toThrow()
    const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
    expect(() => paramsFromJson(JSON.parse(readFileSync(join(root, "data/params/touchline-params.json"), "utf8")))).not.toThrow()
  })
  it("refuses probabilities outside 0..1", () => {
    for (const bad of [{ keeper: { letRunShare: 5 } }, { defending: { foulPerTackle: -0.1 } }, { substitutions: { windowChance: [1, 1.2, 0.5] } }, { kinematics: { reachMargin: 1.5 } }, { fatigue: { halfTimeRecovery: 1.5 } }, { script: { howlerFumble: 2 } }])
      expect(() => paramsFromJson({ provenance: prov, ...bad }), JSON.stringify(bad)).toThrow(/must be between 0 and 1/)
  })
  it("refuses negative values where only magnitudes make sense, but allows signed model coefficients", () => {
    for (const bad of [{ substitutions: { windowSdMin: -1 } }, { kinematics: { reachM: -9 } }, { timing: { restartDelayS: { corner: -5 } } }])
      expect(() => paramsFromJson({ provenance: prov, ...bad }), JSON.stringify(bad)).toThrow(/must not be negative/)
    expect(() => paramsFromJson({ provenance: prov, shot: { xg: { b0: -2 } }, firstTouch: { bSkill: -4 }, defending: { tackleBase: -0.5 } })).not.toThrow()
  })
})

describe("realism v2 P2 params", () => {
  const cc = { dataset: "open data", licence: "CC-BY-4.0", attribution: "Some League; Someone et al.", fitted_at: "2026-10-04", version: "v1" }
  it("ship switched on (Task 8), with the re-fitted rule table, and a drift RNG stream", () => {
    expect(DEFAULT_PARAMS.positioning.rule).toBe(1)
    expect(DEFAULT_PARAMS.movement.relaxed).toBe(1)
    expect(DEFAULT_PARAMS.fatigue.tiring).toBe(1)
    expect(DEFAULT_PARAMS.substitutions.windowMinutes).toEqual([64, 75, 84])
    expect(DEFAULT_PARAMS.substitutions.roleWeights).toEqual({ CB: 0.15, FB: 0.4, DM: 0.7, CM: 0.7, AM: 0.9, W: 1, ST: 0.9 })
    expect(DEFAULT_PARAMS.positioning.roles.CB.in).toEqual({ a: -8.6, b: 0.64, w0: 10.9, w1: -0.11, w2: 0.32, w3: 0.01, e: 0.39 })
    expect(DEFAULT_PARAMS.positioning.roles.ST.out.a).toBe(2.7)
    expect(DEFAULT_PARAMS.positioning.roles.CB.gk).toEqual({ a: -30.5, b: 0, w0: 15.5, w1: 0, w2: 0, w3: 0, e: 0 })
    expect(CONCERNS).toContain("drift")
  })
  it("Task 8b engine defaults: dead-ball drift rate, flat back line, compact block, gk-row timing, build-up full-backs, marking radius", () => {
    const pp = DEFAULT_PARAMS.positioning
    expect(pp.drift.deadRate).toBe(0.25)
    expect(pp.drift.backLineOutU).toBe(0.25)
    expect(pp.drift.outS).toBe(0.5)
    expect(pp.gkTauS).toBe(1.5)
    expect(pp.roles.FB.gk.a).toBe(-13)
    expect(DEFAULT_PARAMS.marking.radiusM).toBe(15)
    expect(() => paramsFromJson({ provenance: cc, positioning: { drift: { deadRate: 1.5 } } })).toThrow(/between 0 and 1/)
    expect(() => paramsFromJson({ provenance: cc, positioning: { drift: { backLineOutU: -0.5 } } })).toThrow(/between 0 and 1/)
    expect(() => paramsFromJson({ provenance: cc, positioning: { drift: { outS: 2 } } })).toThrow(/between 0 and 1/)
    expect(() => paramsFromJson({ provenance: cc, positioning: { gkTauS: -1 } })).toThrow(ParamsError)
  })
  it("accept negative rule-table coefficients from a file, and reject a negative time constant or a share above 1", () => {
    const p = paramsFromJson({ provenance: cc, positioning: { roles: { CB: { out: { a: -20 } } } } })
    expect(p.positioning.roles.CB.out.a).toBe(-20)
    expect(p.positioning.roles.CB.in.a).toBe(-8.6)
    expect(() => paramsFromJson({ provenance: cc, positioning: { tauS: { CB: -1 } } })).toThrow(ParamsError)
    expect(() => paramsFromJson({ provenance: cc, movement: { relaxCap: 1.5 } })).toThrow(/between 0 and 1/)
  })
})

describe("realism v2 P3 params", () => {
  const cc = { dataset: "open data", licence: "CC-BY-4.0", attribution: "Some League; Someone et al.", fitted_at: "2026-10-04", version: "v1" }
  it("ship switched on (Task 10), with the real choice coefficients, four cross zones and two new RNG streams", () => {
    for (const rule of [DEFAULT_PARAMS.firstTick.rule, DEFAULT_PARAMS.choice.rule, DEFAULT_PARAMS.release.rule, DEFAULT_PARAMS.cross.rule, DEFAULT_PARAMS.through.rule, DEFAULT_PARAMS.distribution.rule]) expect(rule).toBe(1)
    // X2 not needed (Task 8 ruling: 30 m+ completion to an available receiver 0.812 with X1 on, at most 0.85).
    expect(DEFAULT_PARAMS.pass.longErrorPerM).toBe(0)
    expect(DEFAULT_PARAMS.choice.base).toEqual({ dist: -1.33, fwd: 0.56, lat: 0.18, lane: -0.55, open: 1.27, lineBreak: 0.04, keeper: 0.95 })
    expect(DEFAULT_PARAMS.choice.press).toEqual({ dist: 0, fwd: 0.22, lat: -0.46, lane: 0, open: -0.58, lineBreak: -0.58, keeper: 0.98 })
    expect(DEFAULT_PARAMS.cross.zones.map((z) => [z.u, z.s, z.height])).toEqual([[47.5, 3, "high"], [41.5, 0, "high"], [47, -4, "high"], [42, 6, "ground"]])
    expect(CONCERNS).toContain("boot")
    expect(CONCERNS).toContain("release")
  })
  it("accept negative choice shifts and zone offsets from a file, and reject a boot-block share above 1 or a negative tail", () => {
    const p = paramsFromJson({ provenance: cc, choice: { kindShift: { switch: -1.25 } } })
    expect(p.choice.kindShift.switch).toBe(-1.25)
    expect(p.choice.kindShift.long_pass).toBe(0)
    expect(paramsFromJson({ provenance: cc }).cross.zones[2]!.s).toBe(-4)
    expect(() => paramsFromJson({ provenance: cc, firstTick: { bootBlock: 1.5 } })).toThrow(/between 0 and 1/)
    expect(() => paramsFromJson({ provenance: cc, release: { tailMeanS: -1 } })).toThrow(ParamsError)
  })
})

describe("realism v2 P4 params", () => {
  const cc = { dataset: "open data", licence: "CC-BY-4.0", attribution: "Some League; Someone et al.", fitted_at: "2026-10-04", version: "v1" }
  it("ship switched on (Task 10; zonal marking from P5 Task 14), with the spec's join table, tackle terms and foul factors, a 6 s release cap, and four new RNG streams", () => {
    const P = DEFAULT_PARAMS
    for (const r of [P.tackle.rule, P.fouls.rule, P.aerial.rule, P.transition.rule, P.press.rule, P.firstTick.scopeRule, P.release.rejudge]) expect(r).toBe(1)
    // Zonal marking (A5) shipped off in P4 (free space 9.6 m against 6.0) and is switched on by P5 Task 14 (asserted below).
    expect(P.release.capS).toBe(6)
    expect(P.transition.joinP).toEqual([0.8, 0.3, 0.23, 0.13, 0.07])
    expect([P.tackle.frontLogit, P.tackle.behindLogit, P.tackle.supportLogit, P.tackle.boxLogit]).toEqual([0.35, -0.35, 0.4, 0.3])
    expect([P.fouls.finalThird, P.fouls.box, P.fouls.behind]).toEqual([0.4, 0.12, 2.4])
    for (const c of ["foul", "aerial", "counter", "press"]) expect(CONCERNS).toContain(c)
  })
  it("reject a P4 switch other than 0 or 1, a join chance above 1, a join table out of order, and accept a negative tackle base", () => {
    expect(() => paramsFromJson({ provenance: cc, press: { rule: 0.5 } })).toThrow(/press\.rule must be 0 or 1/)
    expect(() => paramsFromJson({ provenance: cc, firstTick: { scopeRule: 2 } })).toThrow(/firstTick\.scopeRule must be 0 or 1/)
    expect(() => paramsFromJson({ provenance: cc, transition: { joinP: [1.2, 0.3, 0.23, 0.13, 0.07] } })).toThrow(/between 0 and 1/)
    expect(() => paramsFromJson({ provenance: cc, transition: { joinM: [5, 15, 10, 20, 30] } })).toThrow(/transition\.joinM/)
    expect(paramsFromJson({ provenance: cc, tackle: { base: -0.4 } }).tackle.base).toBe(-0.4)
  })
})

describe("realism v2 P6 params", () => {
  const cc = { dataset: "open data", licence: "CC-BY-4.0", attribution: "Some League; Someone et al.", fitted_at: "2026-10-04", version: "v1" }
  it("ship switched on (Task 8), with the spec's header band, first-time finishes at set pieces and the contact stream", () => {
    const P = DEFAULT_PARAMS
    for (const r of [P.firstTime.rule, P.header.rule, P.saveGeo.rule, P.execFatigue.rule, P.shotModel.rule]) expect(r).toBe(1)
    // User Q1 (a) put corners and free-kick deliveries on; the pre-merge fix (2026-10-21) switched them off again, for
    // first-time finishes and headers together (corner shots within 10 s 53.1 per 100 against P5's 36.7).
    expect(P.firstTime.setPieces).toBe(0)
    expect([P.firstTime.maxGoalM, P.header.zMin, P.header.zMax]).toEqual([25, 1, 2.4])
    // The keys only: Task 7 commits the refit values.
    expect(Object.keys(P.shotModel.xg).sort()).toEqual(Object.keys(P.shot.xg).sort())
    expect(CONCERNS).toContain("contact")
  })
  it("reject a P6 switch other than 0 or 1 and a header band out of order", () => {
    expect(() => paramsFromJson({ provenance: cc, firstTime: { rule: 2 } })).toThrow(/firstTime\.rule must be 0 or 1/)
    expect(() => paramsFromJson({ provenance: cc, firstTime: { setPieces: 0.5 } })).toThrow(/firstTime\.setPieces must be 0 or 1/)
    expect(() => paramsFromJson({ provenance: cc, header: { zMin: 2.5 } })).toThrow(/header\.zMin/)
    expect(paramsFromJson({ provenance: cc, shotModel: { xg: { b0: -2 } } }).shotModel.xg.b0).toBe(-2)
  })
  it.each(["header", "saveGeo", "execFatigue", "shotModel"])("reject %s.rule other than 0 or 1", (block) => {
    expect(() => paramsFromJson({ provenance: cc, [block]: { rule: 0.5 } })).toThrow(new RegExp(`${block}\\.rule must be 0 or 1`))
    expect(paramsFromJson({ provenance: cc, [block]: { rule: 1 } })[block as "header"].rule).toBe(1)
  })
  it("reject an execution-fatigue threshold outside 0..1 and an exponent not above 0", () => {
    expect(() => paramsFromJson({ provenance: cc, execFatigue: { ref: 1 } })).toThrow(/execFatigue\.ref/)
    expect(() => paramsFromJson({ provenance: cc, execFatigue: { ref: 1.5 } })).toThrow(/execFatigue\.ref/)
    expect(() => paramsFromJson({ provenance: cc, execFatigue: { ref: -0.1 } })).toThrow(ParamsError)
    expect(() => paramsFromJson({ provenance: cc, execFatigue: { power: 0 } })).toThrow(/execFatigue\.power/)
    expect(paramsFromJson({ provenance: cc, execFatigue: { ref: 0.5, power: 2 } }).execFatigue.ref).toBe(0.5)
  })
})

describe("realism v2 P5 params", () => {
  const cc = { dataset: "open data", licence: "CC-BY-4.0", attribution: "Some League; Someone et al.", fitted_at: "2026-10-04", version: "v1" }
  it("ship switched on (Task 14) with zonal marking, the real role tables, delay medians and three new RNG streams", () => {
    const P = DEFAULT_PARAMS
    for (const r of [P.setAttack.rule, P.setDefend.rule, P.setShapes.rule, P.deadBall.rule, P.keeperRestarts.rule, P.directFk.rule,
      P.roleMoves.runRule, P.roleMoves.rotateRule, P.marking.landingRule, P.transition.pauseRule, P.release.freeRule, P.marking.rule, P.press.rule]) expect(r).toBe(1)
    expect(P.marking.maxGapM).toBe(5)
    expect(P.setDefend.wallGapM).toBe(1.5)
    expect(P.setAttack.corner.CB).toEqual([42, 4])
    expect(P.deadBall.medianS).toEqual({ throw_in: 13.5, goal_kick: 22, corner: 33, free_kick_att: 42, free_kick: 28, kickoff: 70 })
    expect(P.setAttack.restKeep).toEqual({ corner: 1.4, fk_wide: 2.7, fk_central: 2.3, throw_att: 4.1 })
    for (const c of ["setpiece", "dead", "roles"]) expect(CONCERNS).toContain(c)
  })
  it("reject a P5 switch other than 0 or 1, a wall share above 1, a reversed range, and accept negative table u", () => {
    expect(() => paramsFromJson({ provenance: cc, deadBall: { rule: 2 } })).toThrow(/deadBall\.rule must be 0 or 1/)
    expect(() => paramsFromJson({ provenance: cc, roleMoves: { rotateRule: 0.5 } })).toThrow(/roleMoves\.rotateRule must be 0 or 1/)
    expect(() => paramsFromJson({ provenance: cc, setDefend: { wallWideShare: 1.3 } })).toThrow(/between 0 and 1/)
    expect(() => paramsFromJson({ provenance: cc, deadBall: { walkMps: [1.5, 1] } })).toThrow(/deadBall\.walkMps/)
    expect(paramsFromJson({ provenance: cc, setShapes: { goalKick: { def: { ST: [-24, 9] } } } }).setShapes.goalKick.def.ST).toEqual([-24, 9])
    // The whole zone list (mergeInto keeps array lengths), zone 0 changed.
    const [z, ...rest] = DEFAULT_PARAMS.cross.zones
    expect(() => paramsFromJson({ provenance: cc, cross: { zones: [{ ...z!, u: -5 }, ...rest] } })).toThrow(/cross\.zones\.u must not be negative/)   // the narrowed SIGNED regex
    expect(paramsFromJson({ provenance: cc, cross: { zones: [{ ...z!, s: -3 }, ...rest] } }).cross.zones[0]!.s).toBe(-3)
  })
  it("reject a fractional wall or throw-in count, a throw mark weight above 1, and a delay median or spread that is not positive", () => {
    expect(() => paramsFromJson({ provenance: cc, setDefend: { wallCentral: [3, 3.5] } })).toThrow(/setDefend\.wallCentral\[1\] must be a whole number/)
    expect(() => paramsFromJson({ provenance: cc, setDefend: { wallWide: [0.5, 2] } })).toThrow(/setDefend\.wallWide\[0\] must be a whole number/)
    expect(() => paramsFromJson({ provenance: cc, setShapes: { throwShort: 2.5 } })).toThrow(/setShapes\.throwShort must be a whole number/)
    expect(() => paramsFromJson({ provenance: cc, setShapes: { throwMarkWeight: 1.2 } })).toThrow(/setShapes\.throwMarkWeight must be between 0 and 1/)
    expect(() => paramsFromJson({ provenance: cc, deadBall: { medianS: { corner: 0 } } })).toThrow(/deadBall\.medianS\.corner must be positive/)
    expect(() => paramsFromJson({ provenance: cc, deadBall: { sigma: { kickoff: 0 } } })).toThrow(/deadBall\.sigma\.kickoff must be positive/)
    expect(paramsFromJson({ provenance: cc, setDefend: { wallCentral: [2, 5] }, setShapes: { throwShort: 2 } }).setDefend.wallCentral).toEqual([2, 5])
  })
})
