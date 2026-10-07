import type { MatchInfo } from "@touchline/rpc"
import { LANG_NAMES, t, type Lang } from "./i18n.js"
import { presetProfile, PRESETS, type Profile } from "./profile.js"

const presetLabel = (id: string, match: MatchInfo, lang: Lang) => {
  const p = PRESETS.find((x) => x.id === id)!
  const club = p.club === "home" ? ` · ${match.home.name}` : p.club === "away" ? ` · ${match.away.name}` : ""
  return `${t(lang, p.mode)} · ${LANG_NAMES[p.lang]}${club}`
}

/** Pick a profile: a ready-made one, or build your own from mode, language and club (spec §5.6 profile switcher). */
export const ProfileBar = ({ match, profile, onChange, label }: { match: MatchInfo; profile: Profile; onChange: (p: Profile) => void; label?: string }) => {
  const lang = profile.lang
  const club = profile.clubs[0] ?? ""
  return (
    <fieldset className="flex flex-wrap items-center gap-2 text-sm">
      <legend className="sr-only">{label ?? t(lang, "profile")}</legend>
      <select aria-label={`${label ?? t(lang, "profile")}`} className="rounded bg-slate-800 px-2 py-1" value="" onChange={(e) => e.target.value && onChange(presetProfile(e.target.value, match.home.id, match.away.id))}>
        <option value="">{t(lang, "profile")}…</option>
        {PRESETS.map((p) => <option key={p.id} value={p.id}>{presetLabel(p.id, match, lang)}</option>)}
      </select>
      <select aria-label={`${label ?? ""} mode`.trim()} className="rounded bg-slate-800 px-2 py-1" value={profile.mode} onChange={(e) => onChange({ ...profile, mode: e.target.value as Profile["mode"] })}>
        <option value="casual">{t(lang, "casual")}</option>
        <option value="analyst">{t(lang, "analyst")}</option>
      </select>
      <select aria-label={`${label ?? ""} ${t(lang, "language")}`.trim()} className="rounded bg-slate-800 px-2 py-1" value={profile.lang} onChange={(e) => onChange({ ...profile, lang: e.target.value as Lang })}>
        {(Object.keys(LANG_NAMES) as Lang[]).map((l) => <option key={l} value={l}>{LANG_NAMES[l]}</option>)}
      </select>
      <select aria-label={`${label ?? ""} ${t(lang, "club")}`.trim()} className="rounded bg-slate-800 px-2 py-1" value={club} onChange={(e) => onChange({ ...profile, clubs: e.target.value ? [e.target.value] : [] })}>
        <option value="">{t(lang, "neutral")}</option>
        <option value={match.home.id}>{match.home.name}</option>
        <option value={match.away.id}>{match.away.name}</option>
      </select>
    </fieldset>
  )
}
