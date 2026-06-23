import csv
import os

from embed.compose import compose_embed_text, content_hash
from embed.manifest import load_manifest, save_manifest, diff


def build_index(corpus_path, manifest_path, *, embed_fn, upsert_fn, delete_fn, batch_size=100):
    with open(corpus_path, encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    texts = {r["id"]: compose_embed_text(r) for r in rows}
    current = {rid: content_hash(t) for rid, t in texts.items()}
    d = diff(current, load_manifest(manifest_path))

    to_upsert = d["to_upsert"]
    for i in range(0, len(to_upsert), batch_size):
        batch = to_upsert[i:i + batch_size]
        vecs = embed_fn([texts[rid] for rid in batch])
        upsert_fn([{"id": rid, "values": v} for rid, v in zip(batch, vecs)])
    if d["to_delete"]:
        delete_fn(d["to_delete"])
    save_manifest(manifest_path, current)
    return {"upserted": len(to_upsert), "deleted": len(d["to_delete"]), "total": len(current)}


def _workers_ai_embed(texts):
    """Embed via the Workers AI REST API. Requires CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN."""
    import requests
    acct = os.environ["CLOUDFLARE_ACCOUNT_ID"]
    token = os.environ["CLOUDFLARE_API_TOKEN"]
    url = f"https://api.cloudflare.com/client/v4/accounts/{acct}/ai/run/@cf/baai/bge-m3"
    resp = requests.post(url, headers={"Authorization": f"Bearer {token}"}, json={"text": texts}, timeout=120)
    resp.raise_for_status()
    return resp.json()["result"]["data"]


def _wrangler_upsert(items):
    """Write NDJSON and upsert via wrangler from app/."""
    import json
    import subprocess
    ndjson = "\n".join(json.dumps(it, ensure_ascii=False) for it in items)
    path = "/tmp/vectorize-upsert.ndjson"
    with open(path, "w", encoding="utf-8") as f:
        f.write(ndjson + "\n")
    subprocess.run(["npx", "wrangler", "vectorize", "insert", "proverbs-bge-m3", "--file", path],
                   cwd="app", check=True)


def _wrangler_delete(ids):
    import subprocess
    subprocess.run(["npx", "wrangler", "vectorize", "delete-vectors", "proverbs-bge-m3", "--ids", *ids],
                   cwd="app", check=True)


def main():
    stats = build_index(
        "corpus.csv", "embed/manifest.json",
        embed_fn=_workers_ai_embed, upsert_fn=_wrangler_upsert, delete_fn=_wrangler_delete,
    )
    print(f"embed: upserted={stats['upserted']} deleted={stats['deleted']} total={stats['total']}")


if __name__ == "__main__":
    main()
