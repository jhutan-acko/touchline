import type { Player } from "@touchline/rpc"
import type { BallEvent } from "@touchline/rpc"
import type { PlayerStats } from "./follow.js"
import { t, type Key, type Lang } from "./i18n.js"

const EVENT_KEY: Record<BallEvent["type"], Key> = {
  pass: "evPass", shot: "evShot", carry: "evCarry", tackle: "evTackle", interception: "evInterception", clearance: "evClearance", save: "evSave"
}

/** How an involvement went, as a mark: ✓ it worked (⚽ a goal), ✗ it did not, nothing when unknown. */
const outcomeMark = (o: BallEvent["outcome"]): string => (o === "goal" ? "⚽" : o === "success" ? "✓" : o === null ? "" : "✗")

const num = (v: number | null, digits: number) => (v === null ? "—" : v.toFixed(digits))

/**
 * Follow my player: a small live card over the picture for the viewer's favourite player, with what they have done up
 * to the frame shown (the frozen frame when frozen). Casual viewers get one friendly line; analysts get the numbers.
 * Under it, their last three involvements: tapping one whose frame is still held (`canShow`) freezes on it.
 */
export const PlayerCard = ({ player, team, stats, mode, lang, canShow, onMoment, className = "" }: {
  player: Player
  team: { readonly name: string; readonly kit: { readonly primary: string } }
  stats: PlayerStats
  mode: "casual" | "analyst"
  lang: Lang
  /** Whether a moment's frame can still be shown (frames older than the ring cannot). */
  canShow?: (frame: number) => boolean
  onMoment?: (frame: number) => void
  className?: string
}) => {
  const s = stats
  const rows: Array<[Key, string]> = [
    ["cardDistance", `${num(s.km, 2)} km`],
    ["cardSpeed", `${num(s.kmh, 0)} km/h`],
    ["cardTop", `${num(s.topKmh, 1)} km/h`],
    ["cardPasses", s.passes.tried ? `${s.passes.done}/${s.passes.tried} · ${Math.round(s.accuracy!)}%` : "0/0"],
    ["cardShots", s.goals ? `${s.shots} (${s.goals} ⚽)` : String(s.shots)],
    ["cardDifficulty", s.difficulty === null ? "—" : `${Math.round(s.difficulty)}%`]
  ]
  const casual = t(lang, "cardCasual")
    .replace("{km}", num(s.km, 1))
    .replace("{top}", num(s.topKmh, 0))
    .replace("{done}", String(s.passes.done))
    .replace("{tried}", String(s.passes.tried))
  return (
    <aside aria-label={t(lang, "playerCard")} lang={lang} data-mode={mode} className={`pointer-events-auto w-64 rounded-xl bg-slate-950/85 p-2.5 text-xs shadow-xl ring-1 ring-amber-400/60 backdrop-blur ${className}`}>
      <header className="flex items-center gap-2">
        <span aria-hidden className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm font-bold text-white ring-2 ring-amber-400" style={{ background: team.kit.primary }}>{player.jersey}</span>
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold">{player.name}</h3>
          <p className="truncate text-slate-400">#{player.jersey} · {team.name}</p>
        </div>
      </header>
      {mode === "casual" ? (
        <p data-testid="card-casual" className="mt-2 text-slate-100">{casual}</p>
      ) : (
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-slate-400">{t(lang, k)}</dt>
              <dd data-stat={k} className="text-right tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="mt-2 border-t border-white/10 pt-1.5">
        <h4 className="text-[0.65rem] uppercase tracking-wide text-slate-400">{t(lang, "cardMoments")}</h4>
        {s.moments.length === 0 ? (
          <p className="text-slate-500">{t(lang, "cardNoMoments")}</p>
        ) : (
          <ol aria-label={t(lang, "cardMoments")} className="mt-0.5 flex flex-col gap-0.5">
            {s.moments.map((e) => {
              const body = (
                <>
                  <span className="tabular-nums text-slate-400">{e.clock}</span>
                  <span>{t(lang, EVENT_KEY[e.type])}</span>
                  <span aria-hidden className="ml-auto">{outcomeMark(e.outcome)}</span>
                </>
              )
              return (
                <li key={e.id}>
                  {onMoment && (canShow?.(e.frame) ?? true) ? (
                    <button type="button" title={t(lang, "cardShowMoment")} className="flex w-full items-center gap-2 rounded px-1 text-left hover:bg-slate-800" onClick={() => onMoment(e.frame)}>{body}</button>
                  ) : (
                    <span data-testid="moment" className="flex items-center gap-2 px-1">{body}</span>
                  )}
                </li>
              )
            })}
          </ol>
        )}
      </div>
    </aside>
  )
}
