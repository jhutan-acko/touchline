import type { Series } from "@touchline/rpc"

/** An SVG path through the points (gaps where a value is null), scaled to the box with the values' own range. */
export const linePath = (points: Series["points"], w: number, h: number): string => {
  const vals = points.flatMap((p) => (p.value === null ? [] : [p.value]))
  if (points.length < 2 || !vals.length) return ""
  const [lo, hi] = [Math.min(...vals), Math.max(...vals)]
  const span = hi - lo || 1
  const x = (i: number) => Math.round((i / (points.length - 1)) * w * 10) / 10
  const y = (v: number) => Math.round((h - ((v - lo) / span) * h) * 10) / 10
  let d = ""
  let pen = false
  points.forEach((p, i) => {
    if (p.value === null) {
      pen = false
      return
    }
    d += `${pen ? "L" : "M"}${x(i)},${y(p.value)} `
    pen = true
  })
  return d.trim()
}

export const Sparkline = ({ series }: { series: Series }) => {
  const last = [...series.points].reverse().find((p) => p.value !== null)?.value
  return (
    <figure className="flex items-center gap-3">
      <svg width={160} height={36} viewBox="0 0 160 36" role="img" aria-label={series.label} className="shrink-0 rounded bg-slate-800">
        <path d={linePath(series.points, 160, 36)} fill="none" stroke="#38bdf8" strokeWidth={2} />
      </svg>
      <figcaption className="text-xs text-slate-300">{series.label}{last != null && <span className="ml-1 tabular-nums text-slate-100">{Math.round(last * 1000) / 1000}</span>}</figcaption>
    </figure>
  )
}
