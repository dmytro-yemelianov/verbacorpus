// Render plain-ASCII canonical corpus text as Ukrainian typography (display only).
export function prettify(text: string): string {
  let t = text.replace(/\.\.\./g, "…");          // ... → …
  t = t.replace(/ -{1,2} /g, " — ");             // space-padded hyphen/double-hyphen (тире) → em-dash
  let open = false;
  t = t.replace(/"/g, () => { open = !open; return open ? "«" : "»"; }); // " → « »
  t = t.replace(/'/g, "’");                       // ' → '
  return t;
}
