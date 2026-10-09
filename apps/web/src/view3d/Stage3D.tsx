import { Canvas, useFrame, useThree } from "@react-three/fiber"
import { Component, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react"
import type { MatchInfo } from "@touchline/rpc"
import { loadAssets } from "./assets.js"
import type { CameraKind } from "./cameras.js"
import type { Kick } from "./kick.js"
import { viewports, type Layout, type Viewport } from "./layout.js"
import type { Sample } from "./motion.js"
import { MultiView, setUpRenderer } from "./render.js"
import { World, type Assets } from "./world.js"

/** One play the stage shows: the match as it streams, or a what-if clip. */
export interface Play {
  /** The play at wall-clock time `now` (ms). */
  sample(now: number): Sample | null
  /** Its kicks (found in its frames). */
  kicks(): ReadonlyArray<Kick>
  /** How fast the bodies animate: 0 while paused, else the playback speed. */
  rate(): number
}

export type Plays = { readonly real: Play; readonly variant?: Play }
export type PassLine = { readonly from: string; readonly to: string; readonly colour: string } | null

export interface Stage3DProps {
  readonly match: MatchInfo
  readonly plays: Plays
  readonly mode: "multi" | "split"
  readonly layout: Layout
  readonly camera: CameraKind
  readonly followed: string | null
  /** A player clicked in any view. */
  readonly onPick?: (id: string) => void
  /** Dashed pass lines, per play (the what-if divergence). */
  readonly lines?: Readonly<Partial<Record<Viewport["world"], PassLine>>>
  /** Each viewport's caption. */
  readonly label: (v: Viewport) => string
  readonly loading: string
  /** Shown instead when the players or the stadium light cannot be loaded. */
  readonly failed: string
}

type Live = { multi: MultiView; assets: Assets; worlds: Partial<Record<Viewport["world"], World>> }

/** Inside the canvas: builds the worlds once the assets load, then poses and draws them every animation frame. */
const Scene = ({ props, vps, onReady, onFail, pickRef }: { props: Stage3DProps; vps: ReadonlyArray<Viewport>; onReady: () => void; onFail: () => void; pickRef: { current: ((x: number, y: number) => string | null) | null } }) => {
  const gl = useThree((s) => s.gl)
  const live = useRef<Live | null>(null)
  const latest = useRef({ props, vps })
  latest.current = { props, vps }
  useEffect(() => {
    setUpRenderer(gl)
    let alive = true
    const multi = new MultiView(gl)
    loadAssets(gl).then((assets) => {
      if (!alive) return
      live.current = { multi, assets, worlds: {} }
      pickRef.current = (x, y) => multi.pick(x, y, live.current?.worlds ?? {})
      onReady()
    }, () => alive && onFail())
    return () => {
      alive = false
      multi.dispose()
      for (const w of Object.values(live.current?.worlds ?? {})) w?.dispose()
      live.current = null
      pickRef.current = null
    }
  }, [gl, props.match])
  // Priority 1: we draw every viewport ourselves (R3F's own render is off).
  useFrame((state, dt) => {
    const l = live.current
    if (!l) return
    const { props: p, vps: views } = latest.current
    const now = performance.now()
    const samples: Partial<Record<Viewport["world"], Sample | null>> = {}
    for (const key of ["real", "variant"] as const) {
      const play = p.plays[key]
      if (!play) continue
      const world = (l.worlds[key] ??= new World(l.assets, p.match))
      const s = play.sample(now)
      samples[key] = s
      if (!s) continue
      world.update(s, play.kicks(), p.match.fps, Math.min(0.05, dt) * play.rate())
      const line = p.lines?.[key] ?? null
      world.passLine(line?.from ?? null, line?.to ?? null, line?.colour)
    }
    l.multi.render(views, { worlds: l.worlds, samples, followed: p.followed, dt: Math.min(0.05, dt), time: state.clock.elapsedTime })
  }, 1)
  return null
}

/** Catches the canvas failing to start (no WebGL, a lost GPU), so the page keeps working and says so. */
class CanvasBoundary extends Component<{ children: ReactNode; onError: () => void }, { failed: boolean }> {
  override state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  override componentDidCatch() {
    this.props.onError()
  }
  override render() {
    return this.state.failed ? null : this.props.children
  }
}

/**
 * The 3D view (Plan 7): one WebGL canvas holding every camera of the layout, each viewport with its caption.
 * React Three Fiber hosts the canvas, its size and pixel ratio, and the frame loop.
 */
export const Stage3D = (props: Stage3DProps) => {
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading")
  const pick = useRef<((x: number, y: number) => string | null) | null>(null)
  useEffect(() => {
    const el = box.current
    if (!el || typeof ResizeObserver === "undefined") return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const vps = size.w > 0 ? viewports({ mode: props.mode, layout: props.layout, camera: props.camera, w: size.w, h: size.h }) : []
  const click = (e: MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const id = pick.current?.(e.clientX - r.left, e.clientY - r.top)
    if (id) props.onPick?.(id)
  }
  return (
    <div ref={box} className="relative h-full w-full overflow-hidden rounded-lg bg-black" onClick={click}>
      <CanvasBoundary onError={() => setState("failed")}>
        <Canvas dpr={[1, 2]} gl={{ antialias: false, powerPreference: "high-performance" }} shadows frameloop="always">
          <Scene props={props} vps={vps} onReady={() => setState("ready")} onFail={() => setState("failed")} pickRef={pick} />
        </Canvas>
      </CanvasBoundary>
      {vps.map((v) => (
        <div key={v.key} className="pointer-events-none absolute border border-white/20" style={{ left: v.x, top: v.y, width: v.w, height: v.h }}>
          <span className={`absolute left-2 top-2 whitespace-nowrap rounded bg-slate-950/80 px-2 py-0.5 font-semibold uppercase tracking-wide ${v.inset ? "text-xs" : "text-sm"}`}>{props.label(v)}</span>
        </div>
      ))}
      {state !== "ready" && <p role="status" className="absolute inset-0 grid place-items-center px-4 text-center text-slate-400">{state === "failed" ? props.failed : props.loading}</p>}
    </div>
  )
}
