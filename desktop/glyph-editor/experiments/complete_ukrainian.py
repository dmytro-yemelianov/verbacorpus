"""Generate staged Ukrainian additions for the whole catalog, with resume.

Preparation/application reuse the editor's exact TypeScript model. Generation
never touches project drafts; apply is a separate, locked/backup-protected step.
"""

import argparse
import concurrent.futures
import hashlib
import json
import multiprocessing
import os
import time
from multiprocessing.util import Finalize
from pathlib import Path

from request import require_latin_references

from data import atomic_json, load_json

_engine = None


def initialize(data):
    global _engine
    os.environ.setdefault("OMP_THREAD_LIMIT", "1")
    from infer import Generator

    _engine = Generator(data, neural=False)
    Finalize(None, shutdown, exitpriority=20)


def shutdown():
    if _engine and _engine.optical:
        _engine.optical.close()


def generate(path):
    path = Path(path)
    output = path.parent.parent / "results" / path.name
    request_hash = hashlib.sha256(path.read_bytes()).hexdigest()
    if output.exists():
        existing = load_json(output)
        if existing.get("requestSha256") == request_hash:
            return {
                "id": path.stem,
                "status": "resumed",
                "glyphs": len(existing["results"]),
                "errors": 0,
            }
    request = load_json(path)
    direct = request.get("directCandidates", {})
    start = time.perf_counter()
    results = []
    for item in request["targets"]:
        try:
            require_latin_references({**request, **item})
        except ValueError as error:
            results.append({"character": item["character"], "error": str(error)})
            continue
        if item["character"] in direct:
            results.append(
                {
                    "character": item["character"],
                    "candidates": [direct[item["character"]]],
                }
            )
            continue
        single = {**request, **item}
        single.pop("targets", None)
        single.pop("directCandidates", None)
        try:
            results.append(_engine.candidates(single))
        except (
            ValueError,
            TypeError,
            KeyError,
            IndexError,
            OSError,
            RuntimeError,
        ) as error:
            results.append({"character": item["character"], "error": str(error)})
    response = {
        "format": "para-glyph-candidate-batch",
        "schemaVersion": 1,
        "fontId": request["font"]["id"],
        "revision": request["revision"],
        "results": results,
        "requestSha256": request_hash,
    }
    atomic_json(output, response)
    return {
        "id": path.stem,
        "status": "generated",
        "glyphs": sum(bool(r.get("candidates")) for r in results),
        "errors": sum("error" in r for r in results),
        "seconds": time.perf_counter() - start,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--stage", required=True)
    parser.add_argument("--data", required=True)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()
    stage = Path(args.stage)
    manifest = load_json(stage / "manifest.json")
    paths = sorted(
        stage / "requests" / (font["id"] + ".json")
        for font in manifest["fonts"]
        if font["missing"] > 0
    )
    if args.limit:
        paths = paths[: args.limit]
    start = time.perf_counter()
    progress = []
    with concurrent.futures.ProcessPoolExecutor(
        max_workers=max(1, min(6, args.workers)),
        mp_context=multiprocessing.get_context("spawn"),
        initializer=initialize,
        initargs=(str(Path(args.data).resolve()),),
    ) as pool:
        futures = {pool.submit(generate, str(path)): path.stem for path in paths}
        for future in concurrent.futures.as_completed(futures):
            try:
                result = future.result()
            except (
                ValueError,
                TypeError,
                KeyError,
                IndexError,
                OSError,
                RuntimeError,
            ) as error:
                result = {
                    "id": futures[future],
                    "status": "failed",
                    "errors": 1,
                    "glyphs": 0,
                    "error": str(error),
                }
            progress.append(result)
            if len(progress) % 25 == 0 or len(progress) == len(paths):
                summary = {
                    "fonts": len(progress),
                    "total": len(paths),
                    "glyphs": sum(p["glyphs"] for p in progress),
                    "errors": sum(p["errors"] for p in progress),
                    "seconds": round(time.perf_counter() - start, 1),
                }
                atomic_json(stage / "progress.json", summary)
                atomic_json(stage / "generation-log.json", progress)
                print(json.dumps(summary), flush=True)
    if any(item.get("errors", 0) for item in progress):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
