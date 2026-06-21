from __future__ import annotations

import pandas as pd

from core.schema import Annotation, CanonicalRecord

SOURCE = "Franko1901"


def load(path: str) -> list[CanonicalRecord]:
    df = pd.read_csv(path, dtype=str, keep_default_na=False)
    records: list[CanonicalRecord] = []
    for _, row in df.iterrows():
        text = row["prov_clean"].strip()
        if not text:
            continue
        records.append(
            CanonicalRecord(
                text=text,
                keyword=row["term"].strip(),
                annotations=[
                    Annotation(
                        source=SOURCE,
                        ref=row["letter"].strip(),
                        explanation=row["description"].strip(),
                    )
                ],
            )
        )
    return records
