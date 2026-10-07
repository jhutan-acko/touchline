import { useEffect, useState } from "react"
import { App } from "./App.js"
import type { TouchlineClient } from "./client.js"
import { parseRoute, type Route } from "./route.js"

/** The page the URL hash names (see route.ts), following hash changes. */
export const Root = ({ client }: { client: TouchlineClient }) => {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash))
  useEffect(() => {
    const on = () => setRoute(parseRoute(window.location.hash))
    window.addEventListener("hashchange", on)
    return () => window.removeEventListener("hashchange", on)
  }, [])
  switch (route.page) {
    default:
      return <App client={client} />
  }
}
