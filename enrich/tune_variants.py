from __future__ import annotations

from collections import Counter

from core.dedup import link_variants
from core.schema import CanonicalRecord


def recompute_variant_groups(rows, threshold, max_group_size=None):
    records = [CanonicalRecord(text=r["text"], normalized_text=r["normalized_text"]) for r in rows]
    link_variants(records, threshold=threshold)
    labels = [rec.variant_group for rec in records]
    if max_group_size is not None:
        sizes = Counter(l for l in labels if l)
        labels = ["" if (l and sizes[l] > max_group_size) else l for l in labels]
    out = []
    for r, label in zip(rows, labels):
        nr = dict(r)
        nr["variant_group"] = label
        out.append(nr)
    return out
