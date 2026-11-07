# Glyph editor profiling and code audit · 2026-11-07

Measured locally on this Mac with the pinned 2,266-font catalog and an isolated
copy of the real project: 1,813 draft files, 458,257,408 bytes. No source fonts,
user notes or user drafts were changed by profiling. Browser measurements use
the same Swift store and bundled UI through the loopback preview transport;
they are laboratory results, not field metrics or native WebKit timings.

| Operation | Before | After |
| --- | ---: | ---: |
| Native sidebar/bootstrap summary | 2,995–3,355 ms | 105–240 ms with a valid cache |
| Full copied project: browser UI ready | — | 417 ms from navigation; bootstrap response 219 ms |
| Library navigation/scroll QA traces | Initial trace CLS 0.32 | Repeated Latin + Ukrainian trace CLS 0.02; no tasks over 50 ms |
| Copied project: edit note and flush to disk | — | 48 ms |

The scroll traces include view/group transitions; their CLS values are observed
QA results, not a controlled benchmark with identical navigation state.

The initial cache construction took 4.88 s in this run. The improvement applies
to subsequent loads; changed files are fully revalidated. The native catalog
initialization was about 42 ms. Three relatively large drafts took 1.9–17.6 ms
to read and 5.6–42.8 ms to validate/serialize/save in the native microbenchmark.
The entire file remains the atomic save unit; this is acceptable at the measured
sizes and remains a scaling limit for much larger journals.

A 20-step scroll mounted at most eight cards and 3,694 total DOM elements after
the placeholder fix. The observed JS heap was about 35 MB during that run and
returned to about 8 MB after leaving the library and editing. This is a sampled
observation, not proof of no leaks. A rapid synthetic toggle of all six groups
produced one 51 ms task; the steady scroll run did not. All-group cards contained
up to 233 tiles in the sampled fonts, without horizontal or vertical overflow.
Narrow/wide checks used 1000/1280/1800 px windows, including the final library row.

## Fixed

- Startup parsed and validated the entire 458 MB draft collection for small
  progress counters. A disposable snapshot-scoped summary cache now checks file
  size, modification time and inode, and rebuilds changed/deleted/corrupt entries.
  Opening/saving a draft still performs full validation. Cache-write failure does
  not fail a draft save or startup.
- Loading cards were briefly measured at their empty placeholder height, then
  measured again after glyphs arrived. This expanded the visible set and shifted
  rows repeatedly. Only completed/error cards are measured. Manual anchoring now
  restores the scroll extent before position and survives a column-count change;
  browser anchoring is disabled for this virtualized container.
- Seven older completed drafts still displayed source-only Ukrainian counts.
  Drafts without coverage metadata now receive an exact effective-label/ink
  count during cache construction, without modifying their glyphs or notes.
- The sidebar reference cache accepted a different snapshot, and edited reference
  counts could outlive their revision. Both now check the relevant identity.
- Ukrainian generation could proceed without matching-case Latin references.
  The UI, provider and bulk target planner now gate it on actual mapped ink.
  Greek/OCR proxies and unlabelled statistical fallback were removed.
- Bulk application depended on an external one-off locking script. The public
  command now owns the native-compatible flock and backup, checks staged request
  SHA against the response and returns failure for errors/stale retries. Tampered
  output and a concurrently open project were rejected in isolated checks.
- Native candidate validation still capped dimensions at 256 while the provider
  and editor supported larger common cells. Candidate geometry limits now agree
  at 1024 per axis / 262144 pixels; local reference import keeps its documented
  independent 256 px limit.
- Export metadata contained an obsolete hardcoded application version. Package
  metadata is now shared by the bundle and exporter.
- Preview HTTP parsing accepted negative/malformed/duplicate Content-Length,
  potentially constructing an invalid Data range. These requests now return 400;
  the server stayed responsive after all three probes. This transport is only
  used in development; normal native launch does not open a port.
- Removed unreachable approximation UI/filter paths, unused bulk alias/fallback
  plumbing, and an unused gallery error callback.
- Extreme imported ascent/shift values could stretch a small glyph grid by
  hundreds of rows. Common-cell/guide detection now excludes metric outliers and
  handles the legacy unsigned-byte shift representation for small cells.

## Remaining limitations and follow-up

`ui/editor.ts` remains a roughly 2,100-line orchestration module. Rendering,
mutation, guides, comparisons and generation have separate modules, but document
lifecycle/save coordination and filtering still share mutable state there.
Extracting a document controller is the next structural refactor; a broad rewrite
was not needed to fix the measured stalls and would require separate lifecycle
regression coverage. There is no current trace evidence that splitting this file
alone improves runtime speed.

The corpus-wide result is not a human visual acceptance test. 418 fonts remain
blocked until valid Latin mappings/references are supplied. Retrieval shapes,
mirrors and compositions still need review; OCR calibration does not establish
style correctness. The editor deliberately leaves the generated additions
unreviewed and preserves existing nonempty work.

## Reproduction and validation

Run the native self-test and WKWebView smoke commands in README.md with separate
temporary projects. The native self-test covers summary invalidation, deletion,
corrupt-cache recovery and reference snapshot/revision guards. Run the preview
server on a copy of the large project, record Chrome Performance while switching
groups/scrolling, and separately time the bootstrap bridge call and a save/flush.
Use a fresh cache for initial-scan timing and a retained cache for repeated-load
timing; do not combine them as one startup number.

84 Node tests, 19 Python tests, strict TypeScript, Ruff, native persistence tests
and native WKWebView smoke passed during this audit. An isolated two-font bulk
pipeline generated/applied 66 eligible glyphs and applied none to the unmapped
Classic font. The main source/draft audit verified all 2,266 source SHA hashes,
586 pre-existing nonempty edited glyphs and 11 notes documents.
