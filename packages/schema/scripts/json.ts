import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { CONTRACTS_SCHEMA_PATH, contractsJsonText } from "../src/json.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
mkdirSync(dirname(join(root, CONTRACTS_SCHEMA_PATH)), { recursive: true })
writeFileSync(join(root, CONTRACTS_SCHEMA_PATH), contractsJsonText())
console.log(`wrote ${CONTRACTS_SCHEMA_PATH}`)
