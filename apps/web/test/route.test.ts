import { describe, expect, it } from "vitest"
import { parseRoute, routeHash } from "../src/route.js"

describe("routes", () => {
  it("read the studio, graphics and ops pages of a session from the hash", () => {
    expect(parseRoute("#/studio/s1?seg=analyst.es.neutral")).toEqual({ page: "studio", session: "s1", segment: { mode: "analyst", lang: "es", club: null } })
    expect(parseRoute("#/graphics/s1?seg=casual.hi.northwick&match=m1")).toEqual({ page: "graphics", session: "s1", segment: { mode: "casual", lang: "hi", club: "northwick" }, match: "m1" })
    expect(parseRoute("#/graphics/s1?seg=casual.hi.northwick")).toEqual({ page: "fan" }) // graphics need the match (for the teams)
    expect(parseRoute("#/ops/s1?lang=hi")).toEqual({ page: "ops", session: "s1", lang: "hi" })
    expect(parseRoute("#/ops/s1")).toEqual({ page: "ops", session: "s1", lang: "en" })
  })

  it("fall back to the fan app, and to casual English, on anything else", () => {
    for (const h of ["", "#/", "#/nope", "#/studio", "#/ops/"]) expect(parseRoute(h)).toEqual({ page: "fan" })
    expect(parseRoute("#/studio/s1?seg=loud.xx")).toEqual({ page: "studio", session: "s1", segment: { mode: "casual", lang: "en", club: null } })
  })

  it("write what they read", () => {
    for (const r of [
      { page: "fan" }, { page: "ops", session: "s 1", lang: "es" }, { page: "studio", session: "s1", segment: { mode: "analyst", lang: "hi", club: "larkspur" } },
      { page: "graphics", session: "s1", segment: { mode: "casual", lang: "en", club: null }, match: "lib-x" }
    ] as const) {
      expect(parseRoute(routeHash(r))).toEqual(r)
    }
  })
})
