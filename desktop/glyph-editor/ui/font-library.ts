import type { FontSummary } from "./model";
import type { LatinReferences } from "./latin-references";

export type LibraryFont = Pick<
  FontSummary,
  "id" | "name" | "family" | "cell" | "coverage" | "collection" | "licenseId"
> & { latinReferences?: LatinReferences };
export interface FontProgress {
  edits: number;
  reviewed: number;
  done: boolean;
  ukrainianPresent?: number;
  latinReferences?: LatinReferences;
}

/** Library queries and progress are independent of DOM, open glyph and saving. */
export function createFontLibrary(
  values: LibraryFont[],
  progress: Record<string, FontProgress>,
) {
  const order = new Intl.Collator("uk", { numeric: true });
  const fonts = [...values].sort((a, b) => order.compare(a.name, b.name));
  const entries = fonts.map((font) => ({
    font,
    text: `${font.id} ${font.name} ${font.family}`.toLocaleLowerCase("uk"),
  }));
  return {
    fonts,
    progress,
    counts() {
      const values = Object.values(progress);
      return {
        done: values.filter((p) => p.done).length,
        changed: values.filter((p) => p.edits > 0).length,
      };
    },
    filter(options: { search: string; collection: string; filter: string }) {
      const terms = options.search
        .toLocaleLowerCase("uk")
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      return entries
        .filter(({ font: f, text }) => {
          if (
            !terms.every((term) => text.includes(term)) ||
            (options.collection && f.collection !== options.collection)
          )
            return false;
          const p = progress[f.id],
            refs = p?.latinReferences ?? f.latinReferences;
          switch (options.filter) {
            case "pending":
              return !p?.done;
            case "ua":
              return (
                (p?.ukrainianPresent ?? f.coverage.ukrainian.present ?? 0) < 66
              );
            case "changed":
              return (p?.edits ?? 0) > 0;
            case "latin-missing":
              return !refs?.upper || !refs.lower;
            case "done":
              return !!p?.done;
            default:
              return true;
          }
        })
        .map(({ font }) => font);
    },
  };
}
