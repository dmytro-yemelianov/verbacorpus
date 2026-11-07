import { REGIONS, type GlyphSlot } from "./regions";
import { codepoint } from "./model";
export interface GroupSelection {
  groups: string[];
  upper: boolean;
  lower: boolean;
}
export function visibleCharacter(char: string, selection: GroupSelection) {
  if (char.toUpperCase() === char.toLowerCase()) return true;
  return char === char.toUpperCase() ? selection.upper : selection.lower;
}
export function groupSections(selection: GroupSelection) {
  return REGIONS.filter((r) => selection.groups.includes(r.id)).flatMap((r) =>
    r.sections
      .map((s) => ({
        ...s,
        group: r.id,
        chars: s.chars.filter((c) => visibleCharacter(c, selection)),
      }))
      .filter((s) => s.chars.length),
  );
}
export function selectedGroupSlots(
  selection: GroupSelection,
  index: Map<string, string[]>,
): GlyphSlot[] {
  return groupSections(selection).flatMap((s) =>
    s.chars.map((char) => ({
      key: codepoint(char),
      char,
      id: index.get(char)?.[0],
      section: s.title,
      group: s.group,
    })),
  );
}
export function createGroupSelection(change: () => void) {
  const selection: GroupSelection = {
    groups: ["latin", "ukrainian"],
    upper: true,
    lower: true,
  };
  const host = document.getElementById("glyph-regions")!;
  const checks = new Map<string, HTMLInputElement>();
  const add = (key: string, title: string, checked: boolean) => {
    const label = document.createElement("label"),
      input = document.createElement("input");
    label.className = "inline group-toggle";
    input.type = "checkbox";
    input.checked = checked;
    input.id = `group-${key}`;
    label.append(input, document.createTextNode(title));
    host.append(label);
    checks.set(key, input);
    input.onchange = () => {
      selection.groups = REGIONS.filter((r) => checks.get(r.id)!.checked).map(
        (r) => r.id,
      );
      selection.upper = checks.get("upper")!.checked;
      selection.lower = checks.get("lower")!.checked;
      change();
    };
  };
  REGIONS.forEach((r) => add(r.id, r.title, selection.groups.includes(r.id)));
  host.append(document.createElement("hr"));
  add("upper", "Великі А / A", true);
  add("lower", "Малі а / a", true);
  return {
    get: () => selection,
    save: () => ({
      groups: selection.groups.join(","),
      upper: String(selection.upper),
      lower: String(selection.lower),
    }),
    restore: (saved: Record<string, string>) => {
      if (saved.groups !== undefined)
        selection.groups = saved.groups
          .split(",")
          .filter((id) => REGIONS.some((r) => r.id === id));
      selection.upper = saved.upper !== "false";
      selection.lower = saved.lower !== "false";
      REGIONS.forEach((r) => {
        checks.get(r.id)!.checked = selection.groups.includes(r.id);
      });
      checks.get("upper")!.checked = selection.upper;
      checks.get("lower")!.checked = selection.lower;
    },
  };
}
