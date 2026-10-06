import { Schema } from "effect"
import { AgentContracts } from "./agents.js"

/** Where the exported JSON Schema lives, relative to the repo root (the agents' Pydantic models are generated from it). */
export const CONTRACTS_SCHEMA_PATH = "packages/schema/json/agent-contracts.schema.json"

/** The agent contracts as one JSON Schema (draft 2020-12) document, every named contract under `$defs`. */
export const contractsJsonSchema = (): Record<string, unknown> => {
  const doc = Schema.toJsonSchemaDocument(AgentContracts)
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://touchline.dev/schema/agent-contracts.json",
    title: "AgentContracts",
    ...(doc.definitions.AgentContracts as Record<string, unknown>),
    $defs: Object.fromEntries(Object.entries(doc.definitions).filter(([k]) => k !== "AgentContracts"))
  }
}

/** The exact file contents written to CONTRACTS_SCHEMA_PATH. */
export const contractsJsonText = (): string => JSON.stringify(contractsJsonSchema(), null, 2) + "\n"
