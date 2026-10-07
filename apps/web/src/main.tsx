import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App.js"
import { connect, defaultUrl } from "./client.js"
import "./index.css"

const root = createRoot(document.getElementById("root")!)
connect(defaultUrl()).then(
  (client) => root.render(<StrictMode><App client={client} /></StrictMode>),
  (e) => root.render(<p className="p-8 text-red-300">Cannot reach the API at {defaultUrl()}: {String(e)}. Start it with pnpm api.</p>)
)
