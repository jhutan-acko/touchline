import { LENGTH, WIDTH } from "./draw.js"
import type { StatTag } from "./tags.js"

const tone = (tag: StatTag) =>
  tag.kind === "shot" ? "bg-amber-400 text-slate-950" : tag.kind === "sprint" ? "bg-sky-900/90 text-sky-50 ring-1 ring-sky-300/60" : tag.ok === false ? "bg-slate-900/90 text-slate-300 ring-1 ring-slate-500/60" : "bg-emerald-900/90 text-emerald-50 ring-1 ring-emerald-300/60"

/** The stat tags over the 2D pitch, each above its spot (the pitch canvas fills the same box). */
export const StatTags = ({ tags }: { tags: ReadonlyArray<StatTag> }) => (
  <div aria-label="stat tags" className="pointer-events-none absolute inset-0 overflow-hidden">
    {tags.map((tag) => (
      <span
        key={tag.key}
        data-tag={tag.kind}
        className={`absolute -translate-x-1/2 -translate-y-[140%] whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold shadow transition-opacity duration-300 ${tone(tag)}`}
        style={{ left: `${Math.min(92, Math.max(8, ((tag.x + LENGTH / 2) / LENGTH) * 100))}%`, top: `${Math.min(96, Math.max(10, ((WIDTH / 2 - tag.y) / WIDTH) * 100))}%`, opacity: tag.opacity }}
      >
        {tag.text}
      </span>
    ))}
  </div>
)
