/** Physical key positions are stable across Latin/Cyrillic keyboard layouts. */
export function shortcutKey(event: { code: string; key: string }): string {
  if (/^Key[A-Z]$/.test(event.code)) return event.code.slice(3).toLowerCase();
  if (event.code === "BracketLeft") return "[";
  if (event.code === "BracketRight") return "]";
  if (event.code === "NumpadEnter") return "Enter";
  if (event.code) return event.code;
  return [
    "Enter",
    "Escape",
    "ArrowLeft",
    "ArrowRight",
    "ArrowUp",
    "ArrowDown",
    "PageUp",
    "PageDown",
    "Delete",
    "Backspace",
  ].includes(event.key)
    ? event.key
    : "";
}
