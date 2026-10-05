import { createHash } from "node:crypto"
import { FORMATIONS, Rng, seedRng, type FormationName, type PlayerAttrs, type PlayerSetup, type Role, type TeamSetup, type TeamStyle } from "@touchline/sim-core"

export interface Kit { readonly primary: string; readonly secondary: string }
export interface Club extends TeamSetup {
  readonly short: string
  readonly kits: { readonly home: Kit; readonly away: Kit }
  readonly crest: { readonly shape: "shield" | "circle" | "diamond"; readonly symbol: string }
  readonly squad: ReadonlyArray<PlayerSetup & { readonly name: string; readonly preferredFoot: "left" | "right" }>
}
export interface League { readonly version: string; readonly seed: number; readonly clubs: ReadonlyArray<Club> }

export const ARCHETYPES: Readonly<Record<TeamStyle["archetype"], TeamStyle>> = {
  high_press: { archetype: "high_press", pressIntensity: 0.9, lineHeight: 0.8, compactness: 0.6, tempo: 0.8, longBallBias: -0.2, crossBias: 0, riskTolerance: 0.6 },
  possession: { archetype: "possession", pressIntensity: 0.6, lineHeight: 0.5, compactness: 0.5, tempo: 0.4, longBallBias: -0.6, crossBias: -0.3, riskTolerance: 0.4 },
  direct: { archetype: "direct", pressIntensity: 0.4, lineHeight: 0, compactness: 0.5, tempo: 0.8, longBallBias: 0.7, crossBias: 0.5, riskTolerance: 0.6 },
  low_block: { archetype: "low_block", pressIntensity: 0.15, lineHeight: -0.8, compactness: 0.9, tempo: 0.3, longBallBias: 0.3, crossBias: 0.2, riskTolerance: 0.3 }
}

/** Fixed club identities; names were checked by hand for real-club clashes and are re-checked by the blocklist. */
const CLUB_SEEDS: ReadonlyArray<{ id: string; name: string; short: string; archetype: TeamStyle["archetype"]; formation: FormationName }> = [
  { id: "ironmoor", name: "Ironmoor Athletic", short: "IRO", archetype: "high_press", formation: "4-3-3" },
  { id: "kestrel-bay", name: "Kestrel Bay FC", short: "KES", archetype: "possession", formation: "4-3-3" },
  { id: "harrowmere", name: "Harrowmere Town", short: "HAR", archetype: "direct", formation: "4-4-2" },
  { id: "saltmarsh", name: "Saltmarsh Rovers", short: "SAL", archetype: "low_block", formation: "4-4-2" },
  { id: "eastvale", name: "Eastvale United", short: "EVU", archetype: "possession", formation: "4-2-3-1" },
  { id: "corrin-forge", name: "Corrin Forge", short: "COR", archetype: "high_press", formation: "4-2-3-1" },
  { id: "larkspur", name: "Larkspur City", short: "LAR", archetype: "direct", formation: "3-5-2" },
  { id: "northwick", name: "Northwick Mariners", short: "NOR", archetype: "low_block", formation: "3-5-2" }
]

const FIRST = ["Ka", "Lo", "Me", "Ri", "Da", "Fe", "Ilo", "Ta", "Vo", "Ne", "Sa", "Ju", "Ory", "Bel", "Cai", "Edo", "Mar", "Tor"]
const FIRST_END = ["ren", "vo", "lin", "dan", "mir", "seo", "tan", "ric", "nel", "bo", "ris", "lem"]
const LAST_A = ["Vor", "Hal", "Brek", "Sund", "Okar", "Mell", "Tav", "Quin", "Dren", "Ash", "Lum", "Carr", "Fen", "Wyl", "Ost"]
const LAST_B = ["ane", "ström", "isse", "oway", "ardt", "elli", "ovic", "ham", "ussen", "eda", "ford", "inho", "aro", "berg"]

const hex = (r: Rng) => "#" + Array.from({ length: 3 }, () => Math.floor(r.range(20, 235)).toString(16).padStart(2, "0")).join("")
const luminance = (h: string): number => {
  const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!
}
export const contrast = (a: string, b: string): number => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number]
  return (x + 0.05) / (y + 0.05)
}
const colourDistance = (a: string, b: string): number => {
  const ca = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16)), cb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16))
  return Math.hypot(ca[0]! - cb[0]!, ca[1]! - cb[1]!, ca[2]! - cb[2]!)
}

export const normaliseName = (n: string): string => n.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "")
export const nameHash = (n: string): string => createHash("sha256").update(normaliseName(n)).digest("hex").slice(0, 16)

const ROLE_BIAS: Readonly<Record<Role, Partial<Record<keyof PlayerAttrs, number>>>> = {
  GK: { handling: 0.25, reflexes: 0.25, longPassing: 0.05, pace: -0.15, finishing: -0.3, dribbling: -0.2 },
  CB: { tackling: 0.2, heading: 0.2, pace: -0.05, finishing: -0.2, dribbling: -0.1 },
  FB: { pace: 0.12, crossing: 0.12, stamina: 0.1, tackling: 0.08 },
  DM: { tackling: 0.15, shortPassing: 0.1, vision: 0.05, stamina: 0.08 },
  CM: { shortPassing: 0.15, vision: 0.12, stamina: 0.1 },
  AM: { vision: 0.18, dribbling: 0.12, shortPassing: 0.1, finishing: 0.05 },
  W: { pace: 0.18, dribbling: 0.15, crossing: 0.12 },
  ST: { finishing: 0.22, heading: 0.1, composure: 0.1, pace: 0.05 }
}
const KEYS: ReadonlyArray<keyof PlayerAttrs> = ["pace", "acceleration", "shortPassing", "longPassing", "vision", "crossing", "dribbling", "finishing", "heading", "tackling", "composure", "stamina", "handling", "reflexes"]

const attrsFor = (role: Role, quality: number, r: Rng): PlayerAttrs => {
  const out = {} as Record<keyof PlayerAttrs, number>
  for (const k of KEYS) out[k] = Math.round(Math.max(0.15, Math.min(0.97, quality + (ROLE_BIAS[role][k] ?? 0) + r.normal() * 0.07)) * 100) / 100
  return out
}

const BENCH_ROLES: ReadonlyArray<Role> = ["GK", "CB", "FB", "DM", "CM", "AM", "W", "ST", "CM"]

/** Generate the fictional league deterministically. `blocked` holds name hashes of real players to avoid. */
export const generateLeague = (seed: number, blocked: ReadonlySet<string>): League => {
  const r = new Rng(seedRng(seed))
  const used = new Set<string>()
  const name = (): string => {
    for (;;) {
      const n = `${FIRST[Math.floor(r.uniform() * FIRST.length)]}${FIRST_END[Math.floor(r.uniform() * FIRST_END.length)]} ${LAST_A[Math.floor(r.uniform() * LAST_A.length)]}${LAST_B[Math.floor(r.uniform() * LAST_B.length)]}`
      const h = nameHash(n)
      if (!blocked.has(h) && !used.has(h)) { used.add(h); return n }
    }
  }
  const primaries: string[] = []
  const clubs = CLUB_SEEDS.map((c, ci) => {
    let primary = hex(r)
    while (primaries.some((p) => colourDistance(p, primary) < 90)) primary = hex(r)
    primaries.push(primary)
    let secondary = hex(r)
    while (contrast(primary, secondary) < 3) secondary = hex(r)
    let awayPrimary = hex(r)
    while (colourDistance(awayPrimary, primary) < 140 || contrast(awayPrimary, secondary) < 2) awayPrimary = hex(r)
    const quality = 0.55 + 0.04 * ((ci * 5) % 7) / 6
    const roles = [...FORMATIONS[c.formation].map((s) => s.role), ...BENCH_ROLES]
    const squad = roles.map((role, i) => ({
      id: `p-${c.short.toLowerCase()}-${String(i + 1).padStart(2, "0")}`,
      role,
      jersey: i + 1,
      attrs: attrsFor(role, quality, r),
      name: name(),
      preferredFoot: (r.chance(0.22) ? "left" : "right") as "left" | "right"
    }))
    return {
      id: c.id,
      name: c.name,
      short: c.short,
      formation: c.formation,
      style: ARCHETYPES[c.archetype],
      starters: squad.slice(0, 11),
      bench: squad.slice(11),
      squad,
      kits: { home: { primary, secondary }, away: { primary: awayPrimary, secondary } },
      crest: { shape: (["shield", "circle", "diamond"] as const)[ci % 3]!, symbol: ["anvil", "kestrel", "gate", "wave", "sun", "hammer", "flower", "anchor"][ci]! }
    } satisfies Club
  })
  return { version: "1.0.0", seed, clubs }
}
