import { useEffect, useState } from "react"
import type { MatchSummary } from "@touchline/rpc"
import { App } from "./App.js"
import type { TouchlineClient } from "./client.js"
import { withTeamColours } from "./colours.js"
import { Graphics } from "./Graphics.js"
import { Ops } from "./Ops.js"
import { parseRoute, type Route } from "./route.js"
import { Studio } from "./Studio.js"

/** The graphics output once the match (its teams) is known. */
const GraphicsPage = ({ client, route }: { client: TouchlineClient; route: Extract<Route, { page: "graphics" }> }) => {
  const [match, setMatch] = useState<MatchSummary | null>(null)
  useEffect(() => {
    client.listMatches().then((ms) => {
      const m = ms.find((x) => x.match_id === route.match)
      setMatch(m ? withTeamColours(m) : null)
    }, () => setMatch(null))
  }, [client, route.match])
  return match && <Graphics client={client} session={route.session} segment={route.segment} match={match} />
}

/** The page the URL hash names (see route.ts), following hash changes. */
export const Root = ({ client }: { client: TouchlineClient }) => {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash))
  useEffect(() => {
    const on = () => setRoute(parseRoute(window.location.hash))
    window.addEventListener("hashchange", on)
    return () => window.removeEventListener("hashchange", on)
  }, [])
  switch (route.page) {
    case "graphics":
      return <GraphicsPage client={client} route={route} />
    case "ops":
      return <Ops client={client} session={route.session} lang={route.lang} />
    case "studio":
      return <Studio client={client} session={route.session} segment={route.segment} />
    default:
      return <App client={client} />
  }
}
