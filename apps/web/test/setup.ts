import { cleanup } from "@testing-library/react"
import { afterEach } from "vitest"

// Unmount what each test rendered (Testing Library cleans up by itself only with vitest globals).
afterEach(cleanup)
