from __future__ import annotations

import os
from collections import Counter

from adapters import franko, mlodzynskyi
from core.dedup import link_variants, merge_exact
from core.export import finalize, write_csv, write_json
from core.normalize import normalize
from core.schema import CanonicalRecord


def build_records(sources_dir: str) -> list[CanonicalRecord]:
    records = franko.load(os.path.join(sources_dir, "franko.csv"))
    records += mlodzynskyi.load(
        os.path.join(sources_dir, "proverbs.csv"),
        os.path.join(sources_dir, "proverbs_sources.csv"),
    )
    for rec in records:
        rec.normalized_text = normalize(rec.text)
    records = merge_exact(records)
    records = link_variants(records)
    records = finalize(records)
    return records


def _stats(records: list[CanonicalRecord]) -> dict:
    per_source: Counter[str] = Counter()
    for r in records:
        for s in r.sources():
            per_source[s] += 1
    return {
        "total": len(records),
        "with_explanation": sum(1 for r in records if r.csv_explanation()),
        "variant_groups": len({r.variant_group for r in records if r.variant_group}),
        "per_source": dict(per_source),
    }


def build(sources_dir: str = "data/sources", out_dir: str = ".") -> dict:
    records = build_records(sources_dir)
    write_csv(records, os.path.join(out_dir, "corpus.csv"))
    write_json(records, os.path.join(out_dir, "corpus.json"))
    return _stats(records)


def main() -> None:
    stats = build()
    print("Corpus build complete:")
    print(f"  total entries:      {stats['total']}")
    print(f"  with explanation:   {stats['with_explanation']}")
    print(f"  variant groups:     {stats['variant_groups']}")
    print("  per source:")
    for src, n in sorted(stats["per_source"].items()):
        print(f"    {src}: {n}")


if __name__ == "__main__":
    main()
