# Local glyph-style experiment

This is an original 39,057-parameter conditional CNN and a nearest-font
retrieval baseline. It is **not FontDiffuser, MX-Font or a pretrained foundation
model**. The desktop's “Варіанти гліфа…” runs these local providers, shows up to
8 distinct proposals (retrieval first), can pin one as a backdrop, and applies a chosen bitmap
as one undo transaction. Mapping, dimensions, advance and glyph metrics stay
unchanged. A source font/glyph, license text, model/checkpoint and reference IDs
are retained in the derived export.

Generation runs in a separate owned Python process; it never writes glyph
edits. You can draw during inference. Results from an older document revision,
font or target signature cannot be applied. Cancel terminates the inference
process. There are no network requests or uploads. Failed/missing optional
Python/model dependencies do not affect editing or saving.

## Reference-to-Ukrainian workflow

The 0.10.1 preset uses existing Latin glyphs in the open font as its style
reference and proposes every missing/empty Ukrainian letter. It copies 20
curated Latin/Cyrillic visual pairs at native pixel positions first, then offers
retrieval alternatives for the remaining letters. No per-font training or
PyTorch is needed in retrieval mode. All first choices are previewed; only the
explicit Apply commits one undoable batch. Original Latin and existing nonempty
Ukrainian glyphs are preserved by default.

Custom batches support a different catalog font, a selected set of explicitly
mapped glyphs, or imported Para/glyph JSON, Para Glyph Region, Unicode BDF and
TTF/OTF files. Outline import uses fontTools cmap and Pillow's 1-bit rasterizer;
there is no antialiased output. Import is local, bounded to 8 MiB input and
256×256 reference cells/glyphs. Reference files without explicit license metadata retain
NOASSERTION rather than inheriting a donor's license. No font/reference is
uploaded or added to the corpus.

Batch requests add `referenceFont`, `mode`, `preferLatin` and `targets` to the
existing request. `referenceFont` gives normalization metrics separately from
the destination `font`; targets carry individual characters, geometries and
signatures. Up to 64 mapped reference glyphs and 128 targets are supported.
Retrieval scores all common mapped reference characters (one is sufficient)
and caches the per-donor style ranking across the batch. The old fixed six
reference slots remain the optional CNN conditioning interface; a hybrid batch
can skip neural proposals if those slots are unavailable. Retrieval is the
default and loads neither PyTorch nor a checkpoint.

Each result identifies the reference font, file/base SHA and a SHA of the
actual reference glyph payload; this distinguishes edited/imported references.
Donor and reference identities are separate. Foreign reference glyph IDs remain
foreign on export. Native import runs as an owned cancellable job. Batch
results are bound to their font, document revision and reserved target plan;
ambiguous aliases require an explicit mapping instead of two conflicting edits.

## Prepare and run

The app still uses the local checkout. The optional model/data live in ignored
`desktop/glyph-editor/.build/style-transfer`; neither weights nor corpus
bitmaps are bundled or pushed. Native jobs use `python3` from PATH. On this Mac
that is `/usr/bin/python3`, with PyTorch 2.8.0, NumPy 1.26.4 and working MPS.
Use a Python environment with `requirements.txt` for a fresh setup; launch the
app from that environment if its Python is not the default.

From the repository root:

```sh
python3 desktop/glyph-editor/experiments/data.py \
  --corpus app --output desktop/glyph-editor/.build/style-transfer
python3 desktop/glyph-editor/experiments/train.py \
  --data desktop/glyph-editor/.build/style-transfer --steps 1000
python3 desktop/glyph-editor/experiments/benchmark.py \
  --corpus app --data desktop/glyph-editor/.build/style-transfer
python3 -m unittest discover -s desktop/glyph-editor/experiments -p test_experiment.py
```

The native app uses `candidateStart`, `candidateStatus`, `candidateCancel`.
Each job writes a bounded JSON request, response and log under the editor
project's `candidates/` directory. Request fields: snapshot; font ID/SHA,
cell/metrics; target glyph geometry; revision/signature; character; up to 64
reference glyphs; count. The target's bitmap is zeroed in the request and is
never used by inference. Reference groups are H/Н, x/х, o/о, n/п, k/к, p/р;
the currently edited glyph is excluded. Two groups are required. Current
font cells and glyphs support up to 1024 pixels per axis and 262144 pixels
per bitmap. The model’s canonical representation and training dataset remain
32×32. Ukrainian generation requires explicitly mapped, nonempty Latin references
of the matching case; absent Latin groups block generation. No Unicode mapping
is guessed. Supported targets: Ukrainian, Latin and digits.

## Dataset and protocol

The pinned source snapshot is in `results.json`. Prepare verifies every
selected source SHA and selects records with verified MIT, BSD-2-Clause,
OFL-1.1, CC0-1.0 or CC-BY-SA-4.0 metadata, cells at most 32×32 and at least 24
nonempty Latin letters. The actual run retained **318 records, 129 groups**.
Attributions and complete source/license records stay in the local manifest.
No user drafts or notes are used. This selection is a reproducible prototype
policy, not a legal conclusion about resulting model weights; weights have
not been distributed.

Families and exact normalized Latin duplicates are unioned before splitting.
All Cozette/Spleen groups are held out: **310 training records, eight test
records**. Seven test records have the scored Ukrainian letters. There are
only three Ukrainian-bearing training records, all IBM-family variants.
Consequently this does not establish broad Cyrillic generalization. Test
families are not used for weights, checkpoint selection or benchmark donors.
Training donors are a different training font with the same character; they
may belong to the same training family. Seed 1729, 1,000 fixed updates,
batch size 32, Adam, BCE + Dice; no checkpoint/threshold sweep against test.

Each bitmap is positioned in its cell using bearings and baseline, then
normalized to 32×32 with nearest-neighbor sampling. Content comes from another
font's target character. A style encoder consumes six fixed reference slots
and availability masks; a content encoder and conditional decoder predict
pixel logits. Inference uses threshold 0.5, samples at native destination pixel
centers, preserves destination geometry and deduplicates final 1-bit rows.
The square canonical grid can distort aspect and small details; this is a
baseline rather than a pixel-topology-preserving architecture.

The benchmark hides ҐЄІЇЖЮЯґєіїжюя from each held-out font. The hidden bitmap
is used only for scoring. It compares up to four distinct proposals per method
from training donors; duplicates within a method are removed, and the same
bitmap can count for both providers. Missing letters are skipped. Production
inference can also retrieve held-out fonts as donors, excluding the current
font's group; its results must not be used as holdout benchmark measurements.

## First measured result

90 character cases across two held-out families, at native 6×12 through
16×32 resolutions (with related size variants). They are not 90 independent
styles. MPS training took 9.75 seconds after dataset preparation. See
`results.json` for seed, device, checkpoint SHA, source snapshot and split.

| Raw provider           | Mean best pixel corrections | Exact best matches |
| ---------------------- | --------------------------: | -----------------: |
| Nearest-font retrieval |                       31.73 |             6 / 90 |
| Conditional CNN        |                       29.04 |             0 / 90 |

These are exploratory pixel-distance measurements, **not human acceptance or
legibility scores**. Visual review found collapsed CNN shapes despite the
lower mean pixel distance. The desktop therefore rejects a CNN proposal if
it retains less than 60% of the mapped donor's ink or exceeds 1.8× its ink.
This conservative, post-review guard is not proof of character correctness
and can reject valid thinning. It is applied only to the UI/inference path;
the raw benchmark above is unchanged. The UI reports how many CNN proposals
were rejected. For Cozette Ґ all eight neural proposals were rejected and six
distinct retrieval proposals remained. Empty proposals are always removed.

`benchmark.html` and full per-case `benchmark.json` are generated in the ignored
local data directory. The HTML has original-resolution previews of ground
truth and candidates, including unsuccessful raw neural outputs. Benchmark
inference times exclude Python startup/model loading; the UI labels its timing
as inference time. A fresh app request also pays that startup cost.

## What this establishes and the next experiment

The local GPU pipeline and select/backdrop/edit workflow work. The first CNN
is not a quality win. Keep retrieval and geometric recipes as usable baselines.
Before adding a larger model, expand verified Cyrillic training families,
introduce structure/topology constraints, collect human top-4 acceptance and
manual correction effort, and test the next model on a new untouched family
split. Keep this exploratory set as a regression set rather than reporting
repeated tuning against it as unseen-test performance.

FontDiffuser's [official README](https://github.com/yeungchenwa/FontDiffuser#copyright)
explicitly limits use to non-commercial research. Its code and weights are not
included here. An isolated research comparison can be added separately; there
is no FontDiffuser provider hidden behind the CNN label.
