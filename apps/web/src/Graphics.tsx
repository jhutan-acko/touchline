import { useEffect } from "react"
import type { MatchSummary } from "@touchline/rpc"
import type { Segment } from "@touchline/schema"
import type { TouchlineClient } from "./client.js"
import { Overlays, useNow } from "./Overlays.js"
import { TopBar } from "./TopBar.js"
import { usePane } from "./usePane.js"

/**
 * The broadcast graphics output (spec §5.6 "send to graphics"): a transparent page for a vision mixer or OBS to key
 * over the match picture. It shows the scoreboard and only the cues the producer sent to air, with no pitch and no
 * buttons.
 */
export const Graphics = ({ client, session, segment, match }: { client: TouchlineClient; session: string; segment: Segment; match: Pick<MatchSummary, "home" | "away"> }) => {
  const pane = usePane(client, session, segment, "graphics")
  const now = useNow()
  useEffect(() => {
    const was = document.body.style.background
    document.body.style.background = "transparent"
    return () => {
      document.body.style.background = was
    }
  }, [])
  return (
    <main className="relative h-screen w-screen font-sans text-white">
      <div className="absolute left-6 top-6 w-[32rem]">
        <TopBar match={match} board={pane.board} lang={segment.lang} />
      </div>
      <div className="absolute inset-x-6 bottom-6 top-24">
        <Overlays state={pane} now={now} lang={segment.lang} />
      </div>
    </main>
  )
}
