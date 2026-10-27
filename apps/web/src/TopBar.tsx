import type { MatchSummary } from "@touchline/rpc"
import { t, type Lang } from "./i18n.js"
import type { Board } from "./pane.js"

const Side = ({ short, name, colour, end = false }: { short: string; name: string; colour: string; end?: boolean }) => (
  <span className={`flex min-w-0 items-center gap-2 ${end ? "flex-row-reverse" : ""}`} title={name}>
    <span aria-hidden className="h-6 w-1.5 shrink-0 rounded-full" style={{ background: colour }} />
    <span className="truncate font-semibold tracking-wide">{short}</span>
  </span>
)

/**
 * Score, clock and momentum (the top bar slot of spec §5.4, from the hot path's scoreboard cues): each side's colour
 * chip and short name either side of the score, the clock under it, and momentum as a bar in the two teams' colours.
 */
export const TopBar = ({ match, board, lang }: { match: Pick<MatchSummary, "home" | "away">; board: Board | null; lang: Lang }) => (
  <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl bg-slate-900/90 px-4 py-2 ring-1 ring-slate-800" data-testid="top-bar">
    <div className="grid flex-1 grid-cols-[1fr_auto_1fr] items-center gap-3">
      <Side short={match.home.short} name={match.home.name} colour={match.home.kit.primary} />
      <div className="flex flex-col items-center leading-tight">
        <span className="rounded-md bg-slate-950 px-3 py-0.5 text-2xl font-bold tabular-nums" data-testid="score">{board ? `${board.score.home}–${board.score.away}` : "0–0"}</span>
        <span className="text-xs tabular-nums text-slate-400" data-testid="clock">{board?.clock ?? "00:00"}</span>
      </div>
      <Side short={match.away.short} name={match.away.name} colour={match.away.kit.primary} end />
    </div>
    {board?.momentum && (
      <span className="flex w-full items-center gap-2 text-xs text-slate-400 sm:w-48" title={t(lang, "momentum")}>
        <span className="flex h-2 flex-1 overflow-hidden rounded-full bg-slate-700">
          <span className="block h-full" style={{ width: `${Math.round(board.momentum.home * 100)}%`, background: match.home.kit.primary }} />
          <span className="block h-full flex-1" style={{ background: match.away.kit.primary }} />
        </span>
        {Math.round(board.momentum.home * 100)}%
      </span>
    )}
  </div>
)
