/**
 * Better-pass moments (Plan 7): every verified better pass the library scan found becomes its own cue, in each
 * language, with the numbers from the re-simulation only (no model writes them, so they are verified by design).
 * Its "Why?" evidence is the verdict, and its "Show me" opens the what-if split.
 */
import type { MatchInfo, WhatIfClip } from "@touchline/rpc"
import type { Cue, Segment } from "@touchline/schema"

/** Better-pass moments are named after their pass: `better-<event id>`. */
export const BETTER_PREFIX = "better-"
export const betterMomentId = (eventId: string): string => `${BETTER_PREFIX}${eventId}`
export const betterEventId = (momentId: string | null): string | null => (momentId?.startsWith(BETTER_PREFIX) ? momentId.slice(BETTER_PREFIX.length) : null)

type Lang = Segment["lang"]
const LANGS: ReadonlyArray<Lang> = ["en", "es", "hi"]

interface Words {
  readonly passer: string
  readonly played: string
  readonly better: string
  readonly n: number
  readonly shots: { readonly played: number; readonly better: number }
  readonly gain: string
}

/** The cue's words: shots when the better pass led to more of them, else the value it added. */
export const TEXT: Readonly<Record<Lang, (w: Words) => { readonly headline: string; readonly body: string }>> = {
  en: (w) => ({
    headline: "A better pass was on",
    body:
      w.shots.better > w.shots.played
        ? `${w.passer} played it to ${w.played}; a pass to ${w.better} led to a shot in ${w.shots.better} of ${w.n} re-runs, against ${w.shots.played} of ${w.n}.`
        : `${w.passer} played it to ${w.played}; a pass to ${w.better} was verified better over ${w.n} re-runs (expected goals and threat ${w.gain}).`
  }),
  es: (w) => ({
    headline: "Había un pase mejor",
    body:
      w.shots.better > w.shots.played
        ? `${w.passer} se la dio a ${w.played}; un pase a ${w.better} acabó en tiro en ${w.shots.better} de ${w.n} repeticiones, frente a ${w.shots.played} de ${w.n}.`
        : `${w.passer} se la dio a ${w.played}; un pase a ${w.better} resultó mejor en ${w.n} repeticiones (goles esperados y amenaza ${w.gain}).`
  }),
  hi: (w) => ({
    headline: "एक बेहतर पास मौजूद था",
    body:
      w.shots.better > w.shots.played
        ? `${w.passer} ने गेंद ${w.played} को दी; ${w.better} को पास ${w.n} में से ${w.shots.better} दोबारा-खेलों में शॉट तक पहुँचा, जबकि खेला गया पास ${w.n} में से ${w.shots.played} में।`
        : `${w.passer} ने गेंद ${w.played} को दी; ${w.better} को पास ${w.n} दोबारा-खेलों में बेहतर साबित हुआ (अपेक्षित गोल और ख़तरा ${w.gain})।`
  })
}

const signed = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}`

/** The words of a clip, players named "#9 Name". */
export const wordsOf = (info: MatchInfo, c: WhatIfClip): Words => {
  const who = (id: string | null) => {
    const p = info.players.find((x) => x.id === id)
    return p ? `#${p.jersey} ${p.name}` : (id ?? "")
  }
  return { passer: who(c.passer_id), played: who(c.played_to), better: who(c.better_to), n: c.seeds, shots: c.shots ?? { played: 0, better: 0 }, gain: signed(c.gain?.mean ?? 0) }
}

/** A cue per mode and language for every clip with a verified better option, shown once the clip's real play has run. */
export const betterPassCues = (info: MatchInfo, clips: Iterable<WhatIfClip>): Cue[] =>
  [...clips]
    .filter((c) => c.verdict === "better_option_found" && c.real.length > c.pass_index)
    .flatMap((c) => {
      const pass = c.real[c.pass_index]!
      const words = wordsOf(info, c)
      return (["casual", "analyst"] as const).flatMap((mode) =>
        LANGS.map((lang): Cue => ({
          cue_id: `${betterMomentId(c.event_id)}-${mode}.${lang}.neutral`,
          schema: "touchline.cue/1",
          match_id: info.match_id,
          moment_id: betterMomentId(c.event_id),
          anchor: { frame_from: pass.frame, frame_to: c.real.at(-1)!.frame, clock: pass.clock.slice(0, 5) },
          display: { slot: "lower_third", priority: 2, ttl_ms: 10_000, template: "better_pass" },
          segment: { mode, lang, club: null },
          text: TEXT[lang](words),
          data: { "whatif.seeds": c.seeds, "whatif.shots_played": c.shots?.played ?? 0, "whatif.shots_better": c.shots?.better ?? 0, "whatif.gain": c.gain?.mean ?? 0 },
          evidence: [c.event_id],
          verified: true
        }))
      )
    })
