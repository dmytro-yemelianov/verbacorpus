#!/usr/bin/env python3
"""Resume Pass C with the Gemini Developer API, using local files as checkpoints."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

try:
    from .pass_c import STOPWORDS, fallback_hook, validate_hook
except ImportError:  # Running as: python3 enrich/pass_c_gemini_api.py
    from pass_c import STOPWORDS, fallback_hook, validate_hook


ROOT = Path(__file__).resolve().parent.parent
PASS_C = ROOT / "enrich" / "pass_c"
DEFAULT_MODEL = "gemini-4-hydrogen"
KEYCHAIN_SERVICE = "VerbaCorpus Pass C Gemini"

SYSTEM_INSTRUCTION = """Choose one short, memorable hook for every Ukrainian proverb.
The hook must be an exact, contiguous substring of that proverb, preserving its
spelling, case, apostrophes, and punctuation. It must contain 1–4 whole words,
must not end in a period, and must not end in a Ukrainian function word. Prefer
the image, contrast, or punchline. Return only the requested JSON object, with
every supplied ID exactly once and no additional keys. Never paraphrase or
correct the proverb. If no valid hook can be chosen, return an empty string."""

REPAIR_INSTRUCTION = """Repair only the supplied invalid hooks. Choose a different
exact, contiguous substring from the supplied proverb, preserving spelling,
case, apostrophes, and punctuation. It must contain 1–4 whole words, not end in
a period, and not end in a Ukrainian function word. Return only the requested
JSON object, with every supplied ID exactly once and no additional keys. If no
valid hook can be chosen, return an empty string."""


class ApiHTTPError(RuntimeError):
    def __init__(self, status: int, detail: str = ""):
        message = f"Gemini API returned HTTP {status}"
        if detail:
            message += f": {detail}"
        super().__init__(message + "; batch was not checkpointed")
        self.status = status


def parse_batch(path: Path) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        proverb_id, separator, text = line.partition("\t")
        if not separator or not proverb_id or not text:
            raise ValueError(f"Malformed row {line_number} in {path.name}")
        rows.append({"id": proverb_id, "text": text})
    return rows


def atomic_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    with temp.open("w", encoding="utf-8") as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temp, path)


def response_text(payload: dict[str, Any]) -> str:
    parts = [
        part["text"]
        for candidate in payload.get("candidates", [])
        if isinstance(candidate, dict)
        for part in candidate.get("content", {}).get("parts", [])
        if isinstance(part, dict) and isinstance(part.get("text"), str) and not part.get("thought")
    ]
    if not parts:
        raise ValueError("Gemini response contained no candidate text")
    return "".join(parts)


def decode_json_object(text: str) -> dict[str, Any]:
    candidate = text.strip()
    if candidate.startswith("```"):
        candidate = re.sub(r"^```(?:json)?\s*|\s*```$", "", candidate, flags=re.IGNORECASE).strip()
    try:
        decoded = json.loads(candidate)
    except json.JSONDecodeError:
        start = candidate.find("{")
        if start < 0:
            raise
        decoded, _ = json.JSONDecoder().raw_decode(candidate[start:])
    if not isinstance(decoded, dict):
        raise ValueError("Gemini returned a non-object JSON value")
    return decoded


def call_gemini(records: list[dict[str, str]], api_key: str, model: str, repair: bool = False) -> dict[str, str]:
    ids = [row["id"] for row in records]
    schema = {
        "type": "object",
        "properties": {proverb_id: {"type": "string"} for proverb_id in ids},
        "required": ids,
        "additionalProperties": False,
    }
    lines = "\n".join(f"{row['id']}\t{row['text']}" for row in records)
    generation_config: dict[str, Any] = {
        "responseMimeType": "application/json",
        "responseJsonSchema": schema,
        "maxOutputTokens": 8192,
    }
    if "flash-lite" not in model and not model.startswith("gemini-2.5"):
        generation_config["thinkingConfig"] = {"thinkingLevel": "low"}
    payload = {
        "systemInstruction": {
            "parts": [{
                "text": (REPAIR_INSTRUCTION if repair else SYSTEM_INSTRUCTION)
                + "\nDo not end a hook with any of these words: "
                + ", ".join(sorted(STOPWORDS))
            }]
        },
        "contents": [{"role": "user", "parts": [{"text": "Choose hooks for these proverb rows:\n" + lines}]}],
        "generationConfig": generation_config,
    }
    generate_url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    request = urllib.request.Request(
        generate_url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "x-goog-api-key": api_key,
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=240) as response:
            result = json.loads(response.read())
    except urllib.error.HTTPError as error:
        # Do not print request data or credentials. Stop on errors so a restart
        # cannot silently spend quota by retrying an outcome we did not observe.
        try:
            detail = json.loads(error.read()).get("error", {}).get("message", "")
        except (json.JSONDecodeError, AttributeError):
            detail = ""
        raise ApiHTTPError(error.code, str(detail)[:300]) from None
    except urllib.error.URLError as error:
        raise RuntimeError(f"Gemini API connection failed ({type(error.reason).__name__}); batch was not checkpointed") from None

    raw_text = response_text(result)
    try:
        decoded = decode_json_object(raw_text)
    except (json.JSONDecodeError, ValueError) as error:
        reasons = [candidate.get("finishReason") for candidate in result.get("candidates", []) if isinstance(candidate, dict)]
        raise RuntimeError(
            f"Could not parse Gemini JSON response ({type(error).__name__}, chars={len(raw_text)}, finish={reasons}); batch was not checkpointed"
        ) from None
    return {str(key): value for key, value in decoded.items() if isinstance(value, str)}


def call_gemini_with_503_retries(
    records: list[dict[str, str]],
    api_key: str,
    model: str,
    *,
    repair: bool = False,
    max_retries: int = 3,
    base_delay: float = 15.0,
) -> dict[str, str]:
    for attempt in range(max_retries + 1):
        try:
            return call_gemini(records, api_key, model, repair=repair)
        except ApiHTTPError as error:
            if error.status != 503 or attempt >= max_retries:
                raise
            delay = base_delay * (2 ** attempt)
            print(f"Gemini returned 503; retrying in {delay:g}s ({attempt + 1}/{max_retries})", file=sys.stderr)
            time.sleep(delay)
    raise RuntimeError("Gemini retry loop ended unexpectedly")


def batch_files(start: int) -> list[Path]:
    pattern = re.compile(r"batch_(\d+)\.txt$")
    files = []
    for path in (PASS_C / "batches").glob("batch_*.txt"):
        match = pattern.fullmatch(path.name)
        if match and int(match.group(1)) >= start:
            files.append(path)
    return sorted(files, key=lambda path: int(pattern.fullmatch(path.name).group(1)))


def pending_path(mode: str, batch_id: int) -> Path:
    return PASS_C / "pending" / f"{mode}_{batch_id:04d}.json"


def get_api_key(env_name: str) -> str:
    key = os.environ.get(env_name, "").strip()
    if key or sys.platform != "darwin":
        return key
    try:
        result = subprocess.run(
            ["/usr/bin/security", "find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"],
            capture_output=True,
            text=True,
            check=False,
        )
    except OSError:
        return ""
    return result.stdout.strip() if result.returncode == 0 else ""


def enrich(args: argparse.Namespace, api_key: str) -> int:
    completed = 0
    for batch_path in batch_files(args.start):
        batch_id = int(batch_path.stem.split("_")[-1])
        out_path = PASS_C / "done" / f"batch_{batch_id:04d}.json"
        if out_path.exists():
            pending_path("enrich", batch_id).unlink(missing_ok=True)
            continue
        if args.max_batches and completed >= args.max_batches:
            break
        records = parse_batch(batch_path)
        pending = pending_path("enrich", batch_id)
        if pending.exists():
            raise RuntimeError(f"Unresolved API attempt exists for batch {batch_id}; inspect {pending} before retrying")
        atomic_json(pending, {"mode": "enrich", "batch": batch_id, "started_unix": time.time()})
        try:
            hooks = call_gemini_with_503_retries(
                records, api_key, args.model,
                max_retries=args.max_503_retries,
                base_delay=args.retry_503_delay,
            )
        except ApiHTTPError as error:
            if error.status < 500:
                pending.unlink(missing_ok=True)
            raise
        bad = []
        valid_count = 0
        for row in records:
            hook = hooks.get(row["id"])
            reason = validate_hook(row["text"], hook)
            if reason is None:
                valid_count += 1
            else:
                bad.append({"id": row["id"], "hook": hook, "reason": reason})
        # Keep every returned string for audit; bad entries are repaired later.
        result = {
            "batch": batch_id,
            "total": len(records),
            "ok": valid_count,
            "hooks": hooks,
            "bad": bad,
            "model": args.model,
        }
        atomic_json(out_path, result)
        pending.unlink(missing_ok=True)
        completed += 1
        print(f"saved batch {batch_id}: {valid_count}/{len(records)} valid, {len(bad)} queued for repair")
        if args.min_interval and (not args.max_batches or completed < args.max_batches):
            time.sleep(args.min_interval)
    return completed


def repair(args: argparse.Namespace, api_key: str) -> int:
    repair_targets: list[dict[str, Any]] = []
    unresolved_groups = list((PASS_C / "pending").glob("repair_group_*.json"))
    if unresolved_groups:
        raise RuntimeError(f"Unresolved grouped repair attempt exists; inspect {unresolved_groups[0]}")
    done_files = sorted((PASS_C / "done").glob("batch_*.json"))
    for done_path in done_files:
        batch_id = int(done_path.stem.split("_")[-1])
        if batch_id < args.start:
            continue
        repair_path = PASS_C / "repaired" / f"batch_{batch_id:04d}.json"
        if repair_path.exists():
            pending_path("repair", batch_id).unlink(missing_ok=True)
            continue
        batch_path = PASS_C / "batches" / f"batch_{batch_id:04d}.txt"
        records = parse_batch(batch_path)
        old = json.loads(done_path.read_text(encoding="utf-8"))
        old_hooks = old.get("hooks", {})
        invalid = []
        for row in records:
            hook = old_hooks.get(row["id"]) if isinstance(old_hooks, dict) else None
            if validate_hook(row["text"], hook) is not None:
                invalid.append(row)
        if not invalid:
            continue
        repair_targets.append({"batch": batch_id, "invalid": invalid})

    groups = [repair_targets[i:i + args.repair_group_size] for i in range(0, len(repair_targets), args.repair_group_size)]
    repaired = 0
    for group in groups:
        if args.max_batches and repaired >= args.max_batches:
            break
        batch_ids = [item["batch"] for item in group]
        first_batch, last_batch = batch_ids[0], batch_ids[-1]
        pending = PASS_C / "pending" / f"repair_group_{first_batch:04d}_{last_batch:04d}.json"
        if pending.exists():
            raise RuntimeError(f"Unresolved grouped repair attempt exists; inspect {pending}")
        invalid = [row for item in group for row in item["invalid"]]
        atomic_json(pending, {
            "mode": "repair",
            "batches": batch_ids,
            "attempted": len(invalid),
            "started_unix": time.time(),
        })
        try:
            retried = call_gemini_with_503_retries(
                invalid, api_key, args.model, repair=True,
                max_retries=args.max_503_retries,
                base_delay=args.retry_503_delay,
            )
        except ApiHTTPError as error:
            if error.status < 500:
                pending.unlink(missing_ok=True)
            raise
        final_hooks: dict[int, dict[str, str]] = {batch_id: {} for batch_id in batch_ids}
        sources: dict[int, dict[str, str]] = {batch_id: {} for batch_id in batch_ids}
        row_batch = {
            row["id"]: item["batch"]
            for item in group
            for row in item["invalid"]
        }
        for row in invalid:
            hook = retried.get(row["id"])
            if validate_hook(row["text"], hook) is None:
                final_hooks[row_batch[row["id"]]][row["id"]] = hook
                sources[row_batch[row["id"]]][row["id"]] = "model"
            else:
                fallback = fallback_hook(row["text"])
                fallback_error = validate_hook(row["text"], fallback)
                if fallback_error is not None and fallback:
                    raise RuntimeError(f"Fallback validation failed for {row['id']}: {fallback_error}")
                final_hooks[row_batch[row["id"]]][row["id"]] = fallback
                sources[row_batch[row["id"]]][row["id"]] = "rule"
        for item in group:
            batch_id = item["batch"]
            atomic_json(PASS_C / "repaired" / f"batch_{batch_id:04d}.json", {
                "batch": batch_id,
                "attempted": len(item["invalid"]),
                "hooks": final_hooks[batch_id],
                "hook_source": sources[batch_id],
            })
            pending_path("repair", batch_id).unlink(missing_ok=True)
        pending.unlink(missing_ok=True)
        repaired += 1
        model_count = sum(source == "model" for source_map in sources.values() for source in source_map.values())
        rule_count = sum(source == "rule" for source_map in sources.values() for source in source_map.values())
        print(f"saved repair group {first_batch}..{last_batch}: {len(invalid)} hooks; model={model_count}, rule={rule_count}")
        if args.min_interval and (not args.max_batches or repaired < args.max_batches):
            time.sleep(args.min_interval)
    return repaired


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=("enrich", "repair"), default="enrich")
    parser.add_argument("--model", default=os.environ.get("GEMINI_MODEL", DEFAULT_MODEL), help="Gemini model ID")
    parser.add_argument("--max-503-retries", type=int, default=3, help="retries after HTTP 503 (default: 3)")
    parser.add_argument("--retry-503-delay", type=float, default=15.0, help="base seconds for exponential 503 backoff (default: 15)")
    parser.add_argument("--start", type=int, default=None, help="first batch ID (default: 201 for enrich, 0 for repair)")
    parser.add_argument("--max-batches", type=int, default=1, help="number of API calls; 0 means no limit (default: 1 pilot call)")
    parser.add_argument("--repair-group-size", type=int, default=10, help="invalid batches grouped into each repair request (default: 10)")
    parser.add_argument("--min-interval", type=float, default=6.0, help="seconds between API calls")
    parser.add_argument("--key-env", default="GEMINI_API_KEY", help="environment variable containing the AI Studio API key")
    args = parser.parse_args()
    if args.start is None:
        args.start = 201 if args.mode == "enrich" else 0
    if args.start < 0 or args.max_batches < 0 or args.min_interval < 0 or args.repair_group_size < 1 or args.max_503_retries < 0 or args.retry_503_delay < 0:
        parser.error("start, max-batches, intervals, and retry counts must be non-negative")
    api_key = get_api_key(args.key_env)
    if not api_key:
        print(
            f"No {args.key_env} environment variable or Keychain item '{KEYCHAIN_SERVICE}'. "
            "Add a Gemini API key from a Free-tier AI Studio project; key value is never logged.",
            file=sys.stderr,
        )
        return 2
    try:
        count = enrich(args, api_key) if args.mode == "enrich" else repair(args, api_key)
    except (OSError, ValueError, RuntimeError) as error:
        print(str(error), file=sys.stderr)
        return 1
    print(f"completed {count} {args.mode} API call(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
