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

The 0.14.1 follow-up extracted document navigation/cancellation and serialized
save barriers into `ui/document-controller.ts`, source loading/coverage snapshots
into `ui/font-document.ts`, and library sorting/filtering/progress into
`ui/font-library.ts`. The UI no longer owns debounce/save promises, dirty flags
or source AbortControllers. The remaining approximately 2,000-line `editor.ts`
still wires views, selection and mutation controls together; further decomposition
should target those UI responsibilities. File length alone is not a measured
runtime bottleneck.

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

## 0.14.1 follow-up: document lifecycle and library model

Saving now drains changes that arrive during an in-flight write. Each queued
write has an independent deep snapshot and its original source resource. A failed
write leaves the document dirty and retryable; an older failed autosave cannot
mark a newer successful revision dirty. Navigation waits for the save barrier,
keeps the current source alive until its work is saved, publishes fully loaded
resources, and ignores stale success/failure. A failed load leaves the previous
document usable. Session writes are serialized across debounce and explicit flush.

The browser check injected delayed writes and a simulated disk failure into the
bridge on a full copied project. It verified latest-note persistence, blocked
navigation with the unsaved document retained, successful retry, cancellation by
clicking the active font, and latest-selection wins over a delayed font. A reload
restored the selected font. The saved obsolete-filter probe restored the valid
“All” dropdown and all 2,266 fonts. No working drafts were used for injected faults.

Library sorting reuses one `Intl.Collator`. In a 10-run Node microbenchmark over
the same 2,266 names, the median sort fell from 15.46 ms with per-comparison
`localeCompare` options to 0.65 ms with the reused collator. This measures sorting
alone. The copied-project browser reload measured bootstrap at 168 ms, UI-ready
at 232 ms from navigation, and no tasks over 50 ms; selected-font/workspace state
differs from the earlier run, so this is a regression check, not an end-to-end
speedup claim. The first scan after copying files took 3.47 s, as expected because
copying changes their inode fingerprints.

100 Node tests include 16 lifecycle/library regressions covering delayed writes,
deep snapshots, failure/retry, cancellation, source lifetime, debouncing,
session ordering, filters and updated progress. Native WKWebView/clipboard/close
checks also exercise the new save barrier on both fresh and large copied projects.

## 0.14.2 follow-up: glyph selection and review queues

`glyph-navigation.ts` now owns pure queue policy, stable key/ID restoration,
review filtering, font boundaries and asynchronous selection cancellation.
`font-document.ts` reads each selected source glyph once and keeps original and
draft rasters independent. The UI still coordinates presentation; the refactor
is not a claim that the orchestration file has been fully decomposed.

A selected glyph is published only after pending canvas transfers finish and the
captured document revision/mapping remains current. A concurrent mutation causes
a reread; stale success/failure is ignored. Keyboard repeats in the overview
advance from the pending target, and font paging advances from the requested
font. Pixel mutation shortcuts remain blocked during loading. Failed reads retain
only an image that still belongs to the active queue; otherwise editing is blocked
until another glyph is selected.

Review now waits for clipboard transfers, recognizes both Unicode and glyph-ID
marks, and handles the last/empty queue without reopening the same font. Review finds
the next remaining key, so aliases removed before the selected position cannot
shift it past an unreviewed character. Badges
and the unreviewed filter use the same rule. The checkbox survives session restore.
The Next button updates when font filters change and agrees with keyboard movement
at the last glyph. Async review/complete and Undo/Redo operations check their original context.
Undo/Redo also reject commands while a glyph/font selection is still pending,
including native menu calls that bypass the DOM keyboard handler.

Browser checks used an isolated full-project copy and Cozette's 6,046 glyphs.
With a 600 ms delayed glyph page, selecting g006000 and then g000065 left g000065
selected. A delayed g004000 followed by two right arrows ended at g004002.
A 700 ms clipboard delay left review marks unchanged until paste completed, then
marked the original glyph and advanced once. A one-font/one-unreviewed-glyph
scenario restored after reload and became an empty, non-editable queue after
review. Injected page failures retained A in the all-glyph queue, blocked editing
when a drawing-only queue excluded it, and recovered via an explicit jump.
These faults and generated review marks affected only the disposable project.

A five-run Node stress microbenchmark used 8,832 slots and 5,000 review marks.
Repeated array membership took a median 44.96 ms; constructing a Set and checking
membership took 0.33 ms, with the same 3,832 remaining slots. This is a synthetic
filter-operation measurement, not an app-wide speedup. Both queue filtering and
gallery badges reuse a Set per operation rather than scanning every mark per tile.

122 Node tests include 22 additional navigation/selection regressions; strict
TypeScript, 19 Python tests and native fresh/copied-project smoke checks validate
the surrounding editor behavior. Source fonts and working drafts are unchanged.
