/**
 * The Watch page's space bar: it always toggles this viewer's freeze, even with a button or link focused (whose own
 * Space press would otherwise click it, or a focused 2D/3D toggle would flip the view). It is left alone while typing
 * (inputs, text areas, selects, editable text) and inside the Ask drawer, whose buttons and chips are a form the
 * viewer is filling in on a frozen frame (Space on a chip there must not resume the match).
 */
export const ASK_DRAWER_ATTR = "data-ask-drawer"

export const isTyping = (el: EventTarget | null): boolean =>
  el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || (el instanceof HTMLElement && el.isContentEditable)

/** Whether this key press is the space bar the Watch page takes for freeze / resume. */
export const spaceToggles = (e: Pick<KeyboardEvent, "key" | "repeat" | "target" | "altKey" | "ctrlKey" | "metaKey">): boolean => {
  if (e.key !== " " || e.repeat || e.altKey || e.ctrlKey || e.metaKey) return false
  if (isTyping(e.target)) return false
  if (e.target instanceof Element && e.target.closest(`[${ASK_DRAWER_ATTR}]`)) return false
  return true
}
