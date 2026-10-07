import { cleanup } from "@testing-library/react"
import { afterEach } from "vitest"

// Unmount what each test rendered (Testing Library cleans up by itself only with vitest globals).
afterEach(cleanup)

// jsdom has no canvas: components get no 2D context (drawing is tested with a recording context, test/draw.test.ts).
if (typeof HTMLCanvasElement !== "undefined") HTMLCanvasElement.prototype.getContext = (() => null) as never
