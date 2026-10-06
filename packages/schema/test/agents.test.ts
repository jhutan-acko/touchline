import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Schema } from "effect"
import { describe, expect, it } from "vitest"
import { AgentContracts, decodeAgentRequest, decodeCue, MAX_SEGMENTS, segmentKey } from "../src/agents.js"
import { CONTRACTS_SCHEMA_PATH, contractsJsonSchema, contractsJsonText } from "../src/json.js"

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, "../../..")
const fixtures = (kind: "valid" | "invalid") =>
  readdirSync(join(here, "../fixtures/agents", kind)).map((f) => ({ file: f, ...(JSON.parse(readFileSync(join(here, "../fixtures/agents", kind, f), "utf8")) as { contract: string; value: unknown }) }))
// One decoder per contract, taken from the bundle so every fixture is checked against exactly what is exported.
const decoders = Object.fromEntries(Object.entries(AgentContracts.fields).map(([k, s]) => [k, Schema.decodeUnknownSync(s as Schema.Decoder<unknown>)]))

describe("agent contracts", () => {
  it("decodes every valid fixture", () => {
    const valid = fixtures("valid")
    expect(valid.length).toBeGreaterThanOrEqual(6)
    for (const f of valid) expect(() => decoders[f.contract]!(f.value), f.file).not.toThrow()
  })
  it("rejects every invalid fixture", () => {
    const invalid = fixtures("invalid")
    expect(invalid.length).toBeGreaterThanOrEqual(8)
    for (const f of invalid) expect(() => decoders[f.contract]!(f.value), f.file).toThrow()
  })
  it("keeps the cue shape of spec §5.4", () => {
    const cue = decodeCue(fixtures("valid").find((f) => f.file === "cue.json")!.value)
    expect(cue.schema).toBe("touchline.cue/1")
    expect(cue.anchor).toEqual({ frame_from: 39880, frame_to: 40213, clock: "67:02" })
  })
  it("tells signals and recap requests apart by kind", () => {
    const kinds = fixtures("valid").filter((f) => f.contract === "request").map((f) => decodeAgentRequest(f.value).kind)
    expect(kinds.sort()).toEqual(["recap", "signals"])
  })
  it("keys segments by mode, language and club", () => {
    expect(segmentKey({ mode: "analyst", lang: "hi", club: null })).toBe("analyst.hi.neutral")
    expect(segmentKey({ mode: "casual", lang: "es", club: "ironmoor" })).toBe("casual.es.ironmoor")
    expect(MAX_SEGMENTS).toBe(12)
  })
})

describe("JSON Schema export", () => {
  it("names every contract under $defs", () => {
    const defs = Object.keys(contractsJsonSchema().$defs as object)
    for (const name of ["Signal", "Moment", "Claim", "Analysis", "Draft", "Verdict", "Cue", "Recap", "MomentTrace", "SignalsRequest", "RecapRequest", "Segment"]) expect(defs).toContain(name)
  })
  it("matches the committed file (run `pnpm --filter @touchline/schema json` after changing a contract)", () => {
    expect(readFileSync(join(root, CONTRACTS_SCHEMA_PATH), "utf8")).toBe(contractsJsonText())
  })
})
