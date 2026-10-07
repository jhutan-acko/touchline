import type { MatchSummary } from "@touchline/rpc"
import { t, type Lang } from "./i18n.js"
import type { Board } from "./pane.js"

/** Score, clock and momentum (the top bar slot of spec §5.4, from the hot path's scoreboard cues). */
export const TopBar = ({ match, board, lang }: { match: Pick<MatchSummary, "home" | "away">; board: Board | null; lang: Lang }) => (
  <div className="flex items-center justify-between rounded-lg bg-slate-900 px-4 py-2 ring-1 ring-slate-800" data-testid="top-bar">
    <span className="font-semibold">{match.home.short}</span>
    <span className="text-xl font-bold tabular-nums" data-testid="score">{board ? `${board.score.home}–${board.score.away}` : "0–0"}</span>
    <span className="font-semibold">{match.away.short}</span>
    <span className="tabular-nums text-slate-300" data-testid="clock">{board?.clock ?? "00:00"}</span>
    {board?.momentum && (
      <span className="flex w-40 items-center gap-2 text-xs text-slate-400" title={t(lang, "momentum")}>
        <span className="h-2 flex-1 overflow-hidden rounded bg-slate-700">
          <span className="block h-full" style={{ width: `${Math.round(board.momentum.home * 100)}%`, background: match.home.kit.primary }} />
        </span>
        {Math.round(board.momentum.home * 100)}%
      </span>
    )}
  </div>
)
