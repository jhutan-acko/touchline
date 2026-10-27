/**
 * The Watch page's controls: a compact fan bar (back, play/pause, speed, 2D/3D, profile) and, at its end, a
 * "Broadcast tools" menu for the studio, graphics and ops pages, the split screen and the what-if auto-show. Plus the
 * first-visit hint about pausing to ask.
 */
import { useEffect, useRef, useState, type ReactNode } from "react"
import { t, type Lang } from "./i18n.js"

const BTN = "rounded-lg bg-slate-800 px-3 py-1.5 text-sm hover:bg-slate-700"

export const FanBar = ({ lang, onBack, frozen, onToggleFreeze, onAsk, speeds, speed, onSpeed, view, webgl, onView, profile, tools }: {
  lang: Lang
  onBack: () => void
  frozen: boolean
  onToggleFreeze: () => void
  /** Reopen Ask (shown while frozen with the drawer closed), or undefined. */
  onAsk?: (() => void) | undefined
  speeds: ReadonlyArray<number>
  speed: number
  onSpeed: (s: number) => void
  view: "2d" | "3d"
  webgl: boolean
  onView: (v: "2d" | "3d") => void
  profile: ReactNode
  tools: ReactNode
}) => (
  <div role="toolbar" aria-label={t(lang, "matchControls")} className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-900/60 p-2 ring-1 ring-slate-800">
    <button type="button" className={BTN} onClick={onBack}>← {t(lang, "back")}</button>
    <button type="button" className={`min-w-20 rounded-lg px-3 py-1.5 text-sm font-semibold ${frozen ? "bg-amber-400 text-slate-950 hover:bg-amber-300" : "bg-emerald-600 text-white hover:bg-emerald-500"}`} aria-pressed={frozen} onClick={onToggleFreeze}>
      <span aria-hidden className="mr-1.5">{frozen ? "▶" : "❚❚"}</span>
      {frozen ? t(lang, "play") : t(lang, "pause")}
    </button>
    {onAsk && <button type="button" className="rounded-lg bg-amber-400 px-3 py-1.5 text-sm font-semibold text-slate-950" onClick={onAsk}>{t(lang, "askReopen")}</button>}
    <label className="flex items-center gap-1 text-sm text-slate-300">
      <span className="sr-only sm:not-sr-only">{t(lang, "speed")}</span>
      <select aria-label={t(lang, "speed")} className="rounded-lg bg-slate-800 px-2 py-1.5" value={speed} onChange={(e) => onSpeed(Number(e.target.value))}>
        {speeds.map((s) => <option key={s} value={s}>×{s}</option>)}
      </select>
    </label>
    <div role="group" aria-label={t(lang, "view")} className="flex gap-0.5 rounded-lg bg-slate-800 p-0.5">
      {(["2d", "3d"] as const).map((v) => (
        <button key={v} type="button" aria-pressed={view === v} disabled={v === "3d" && !webgl} title={v === "3d" && !webgl ? t(lang, "noWebgl") : undefined}
          className={`rounded-md px-2.5 py-1 text-sm disabled:opacity-50 ${view === v ? "bg-slate-200 text-slate-950" : "hover:bg-slate-700"}`} onClick={() => onView(v)}>
          {t(lang, v === "3d" ? "view3d" : "view2d")}
        </button>
      ))}
    </div>
    <div className="min-w-0">{profile}</div>
    <div className="ml-auto">{tools}</div>
  </div>
)

/** The broadcast and developer tools, out of the fan's way behind one button. */
export const BroadcastMenu = ({ lang, links, split, onSplit, autoWhatIf, onAutoWhatIf }: {
  lang: Lang
  links: ReadonlyArray<{ readonly label: string; readonly href: string }>
  split: boolean
  onSplit: () => void
  autoWhatIf: boolean
  onAutoWhatIf: (on: boolean) => void
}) => {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false)
    document.addEventListener("mousedown", away)
    window.addEventListener("keydown", esc)
    return () => {
      document.removeEventListener("mousedown", away)
      window.removeEventListener("keydown", esc)
    }
  }, [open])
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-expanded={open} aria-haspopup="true" className={BTN} onClick={() => setOpen(!open)}>
        {t(lang, "broadcastTools")} <span aria-hidden>▾</span>
      </button>
      {open && (
        <div role="group" aria-label={t(lang, "broadcastTools")} className="absolute right-0 z-40 mt-1 flex w-64 flex-col gap-1 rounded-xl bg-slate-900 p-2 text-sm shadow-xl ring-1 ring-slate-700">
          {links.map((l) => (
            <a key={l.href} className="rounded-lg px-3 py-1.5 hover:bg-slate-800" target="_blank" rel="noreferrer" href={l.href} onClick={() => setOpen(false)}>{l.label} <span aria-hidden>↗</span></a>
          ))}
          <button type="button" className="rounded-lg px-3 py-1.5 text-left hover:bg-slate-800" onClick={() => (onSplit(), setOpen(false))}>{split ? t(lang, "single") : t(lang, "split")}</button>
          <label className="flex items-center gap-2 rounded-lg px-3 py-1.5 hover:bg-slate-800">
            <input type="checkbox" checked={autoWhatIf} onChange={(e) => onAutoWhatIf(e.target.checked)} />
            {t(lang, "autoWhatIf")}
          </label>
        </div>
      )}
    </div>
  )
}

/** Remembered once seen, so the hint shows on a viewer's first visit only. */
export const HINT_KEY = "touchline.hint.pause"
/** How long the hint stays up by itself. */
export const HINT_MS = 8_000

const seen = () => {
  try {
    return localStorage.getItem(HINT_KEY) === "1"
  } catch {
    return false
  }
}
const markSeen = () => {
  try {
    localStorage.setItem(HINT_KEY, "1")
  } catch {
    // blocked storage: it shows again next visit
  }
}

/** "Press Space or tap Pause to ask about any moment": first visit only, gone after a few seconds or the first pause. */
export const PauseHint = ({ lang, frozen }: { lang: Lang; frozen: boolean }) => {
  const [show, setShow] = useState(() => !seen())
  const hide = () => {
    markSeen()
    setShow(false)
  }
  useEffect(() => {
    if (!show) return
    const timer = setTimeout(hide, HINT_MS)
    return () => clearTimeout(timer)
  }, [show])
  useEffect(() => {
    if (frozen && show) hide()
  }, [frozen])
  if (!show) return null
  return (
    <p role="note" className="pointer-events-auto absolute left-1/2 top-3 z-20 flex max-w-[90%] -translate-x-1/2 items-center gap-2 rounded-full bg-slate-950/85 px-4 py-1.5 text-sm text-slate-100 shadow-lg ring-1 ring-white/10">
      <kbd className="rounded bg-slate-700 px-1.5 text-xs">Space</kbd>
      <span>{t(lang, "pauseHint")}</span>
      <button type="button" aria-label={t(lang, "dismiss")} className="text-slate-400 hover:text-white" onClick={hide}>×</button>
    </p>
  )
}
