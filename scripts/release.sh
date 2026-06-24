#!/usr/bin/env bash
# Build verba corpus release assets and (with --publish) create the GitHub Release.
# Usage: scripts/release.sh [--publish]
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
command -v zip >/dev/null 2>&1 || { echo "ERROR: zip not found (install: apt install zip)" >&2; exit 1; }
VERSION="$(cat VERSION)"
TAG="v${VERSION}"
REPO="dmytro-yemelianov/verbacorpus"

# 1. Consistency guard: VERSION must match CITATION.cff + croissant.json
cff_v="$(grep -E '^version:' CITATION.cff | head -1 | sed -E 's/version:[[:space:]]*//; s/["'\'' ]//g')"
cro_v="$(grep -oE '"version"[[:space:]]*:[[:space:]]*"[^"]+"' croissant.json | head -1 | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')"
if [ "$cff_v" != "$VERSION" ] || [ "$cro_v" != "$VERSION" ]; then
  echo "ERROR: version mismatch — VERSION=$VERSION CITATION.cff=$cff_v croissant.json=$cro_v" >&2
  exit 1
fi

# 2. Stage assets
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
cp corpus.csv corpus.json corpus.xml DATACARD.md croissant.json references.bib references.csl.json "$STAGE/"
# corpus.jsonl from the array corpus.json
python3 -c "import json,sys; [sys.stdout.write(json.dumps(r,ensure_ascii=False)+'\n') for r in json.load(open('corpus.json'))]" > "$STAGE/corpus.jsonl"

# 3. sha256s + fill croissant's CSV hash
CSV_SHA="$(sha256sum "$STAGE/corpus.csv" | cut -d' ' -f1)"
sed "s/PLACEHOLDER_SHA256/${CSV_SHA}/" croissant.json > "$STAGE/croissant.json"

# 4. zip bundle
ZIP="verba-corpus-${TAG}.zip"
( cd "$STAGE" && zip -q "$ROOT/$ZIP" corpus.csv corpus.json corpus.jsonl corpus.xml croissant.json DATACARD.md references.bib references.csl.json )

# 5. release notes from CHANGELOG's top section
NOTES="$STAGE/notes.md"
awk '/^## \[/{c++} c==1{print} c==2{exit}' CHANGELOG.md > "$NOTES"
{ echo; echo "**SHA256** \`corpus.csv\`: \`${CSV_SHA}\`"; echo; echo "Live: https://verbacorpus.org · API: https://verbacorpus.org/api.html · License: CC BY 4.0 (compilation)"; } >> "$NOTES"

echo "== Release $TAG =="
echo "Assets: $ZIP, corpus.csv, corpus.json, croissant.json, DATACARD.md"
echo "corpus.csv sha256: $CSV_SHA"
echo "--- notes ---"; cat "$NOTES"; echo "-------------"

if [ "${1:-}" = "--publish" ]; then
  gh release create "$TAG" --repo "$REPO" --title "verba corpus ${TAG}" --notes-file "$NOTES" \
    "$ZIP" corpus.csv corpus.json "$STAGE/croissant.json#croissant.json" DATACARD.md references.bib references.csl.json
  echo "Published: https://github.com/$REPO/releases/tag/$TAG"
else
  echo "(dry run — re-run with --publish to create the GitHub Release)"
fi
