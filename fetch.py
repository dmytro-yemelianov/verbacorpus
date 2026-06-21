from __future__ import annotations

import os
import urllib.request

OWNER = "MurzikVasilyevich"


def raw_url(repo: str, path: str) -> str:
    return f"https://raw.githubusercontent.com/{OWNER}/{repo}/HEAD/{path}"


# local filename -> (repo, path-in-repo)
SOURCES: dict[str, tuple[str, str]] = {
    "franko.csv": ("ukr-proverbs-franko", "franko.csv"),
    "proverbs.csv": ("ukr-proverbs", "proverbs.csv"),
    "proverbs_sources.csv": ("ukr-proverbs", "proverbs_sources.csv"),
    "sources.csv": ("ukr-proverbs", "sources.csv"),
}


def _default_fetcher(url: str) -> bytes:
    with urllib.request.urlopen(url) as resp:  # noqa: S310 (trusted host)
        return resp.read()


def fetch_all(dest_dir: str = "data/sources", fetcher=_default_fetcher) -> list[str]:
    os.makedirs(dest_dir, exist_ok=True)
    written: list[str] = []
    for local_name, (repo, path) in SOURCES.items():
        data = fetcher(raw_url(repo, path))
        out_path = os.path.join(dest_dir, local_name)
        with open(out_path, "wb") as f:
            f.write(data)
        written.append(out_path)
    return written


if __name__ == "__main__":
    for p in fetch_all():
        print("wrote", p)
