# Octagram-Vyshyvanka Animated Share Cards — Design

**Date:** 2026-06-24
**Status:** Approved (brainstorming)

## Goal

Upgrade the existing animated GIF share-card route (`/card/:id.gif`) from a 2-frame
blink to a **procedurally generated, pixelated Ukrainian-embroidery (vyshyvanka)
animation**, by porting the Shadertoy *Octagrams* fragment shader
(<https://www.shadertoy.com/view/tlVGDt>, whisky_shusuky) to a **CPU software shader**
that runs inside the Cloudflare Worker (no GPU available).

The octagram = eight-pointed star = a core vyshyvanka motif (Алатир / ромб-зірка), so
the ported field, pixelated and recolored to red-on-cream, reads as animated cross-stitch.

## Locked parameters (from user)

- **Pattern resolution:** ≤ **30 cells on the longer side** (ultra-chunky stitches; also
  makes the CPU raymarch trivially cheap — ~30×16 ≈ 500 px/frame).
- **Motion:** **color-cycle focus** — geometry is computed once and held static; the
  red↔black thread colors shimmer/scroll through the stitches across the loop.
- **Layout:** **border bands** — octagram pattern frames the card as a рушник border
  (top + bottom); the proverb sits on a clean cream center for legibility.
- **Palette (fixed):** cream `#f4f1e8`, red `#b4232a`, deep red `#7d1620`, black `#1a1a1a`.

## Architecture (isolated, testable units)

1. **`app/src/shader/octagrams.ts`** — pure port of the shader.
   - `rot`, `sdBox`, `box`, `boxSet`, `mapScene`, and `octagramAc(px,py,W,H,time,steps)`
     returning the accumulated glow `ac` for one sample (the `for i<99` march with
     `ac += exp(-d*23)`).
   - `octagramField(gw, gh, {time, steps})` → `Float32Array` of length `gw*gh`,
     normalized to `[0,1]`. **Computed once** (static geometry).
   - No I/O, no Worker APIs. Unit-tested in Node (vitest).

2. **`app/src/shader/vyshyvanka.ts`** — field → pixels.
   - `VYSHYVANKA` palette constants.
   - `stitchColor(intensity, phase)` → palette index: below a threshold → cream (no
     stitch); above → red or black chosen by a phase-scrolling band
     (`sin(intensity*K - phase*2π)`), producing the color-cycle shimmer.
   - `paintBands(rgba, W, H, grid, gw, gh, phase, bandPx)` — nearest-neighbor upscale of
     the stitch grid into the **top and bottom band regions only**; center left untouched.
   - Pure; unit-tested (dimensions, band masking, deterministic color cycling, seamless
     loop: `phase(0)` ≈ `phase(1)`).

3. **`app/src/card.ts`** — add a **GIF text-layer mode** to `renderCard`:
   `opts.layer = true` → transparent root background + extra top/bottom padding
   (= band height + margin) so text/bar/QR sit in the safe center between the bands.

4. **`app/src/card-gif.ts`** — orchestration:
   - Render the text layer **once** via Satori (transparent, inset) → decode RGBA (upng).
   - Build the cream base; compute `octagramField` once.
   - For each of **N≈14 frames**: copy cream base → `paintBands` with `phase = i/N` →
     alpha-composite the cached text RGBA on top.
   - Build a **global palette from frame 0** (covers text AA + all four vyshyvanka colors,
     since every frame contains both red and black) and `applyPalette` to all frames →
     crisp, small, fast (no per-frame quantize).
   - `gifenc.writeFrame` per frame (`delay ≈ 110ms`); return bytes.

5. **`app/src/index.ts`** — replace the `makeAnimatedGif(buf0, buf1)` call in the
   `/card/:id.gif` handler with the new pipeline. Caching unchanged (1 yr / daily).

## Data flow

```
proverb → cardModel → renderCard(layer) ──Satori──▶ text PNG ──upng──▶ textRGBA (once)
octagramField(gw,gh) (once) ─┐
                             ▼  per frame i:
cream base ─▶ paintBands(phase=i/N) ─▶ composite(textRGBA) ─▶ applyPalette(globalPalette) ─▶ writeFrame
                                                                                              ▼
                                                                                          gifenc → image/gif
```

## Performance / limits

- Field: ≤30×~16 cells × ≤64 steps × 6 SDF boxes ≈ <140k evals, computed **once** → negligible.
- Frames: color-cycle reuses the field; per-frame cost is upscale + composite + applyPalette.
- Memory: square 1080² × 14 indexed frames ≈ 16 MB + work buffers — within Worker limits.
- Paid plan (already required for semantic search) covers CPU budget; results cached.

## Scope / deliverable

- Upgrade applies to **all** `/card/:id.gif` requests.
- Concrete deliverable: generate **square-format GIFs for the 9 news→proverb proverbs**
  (the `verba-news-proverbs-uk` set) and hand them to the user.

## Testing

- TDD for `octagrams.ts` and `vyshyvanka.ts` (pure): value sanity, normalization range,
  grid dimensions, band masking, color-cycle determinism, seamless-loop continuity.
- Route smoke test: `/card/daily.gif?format=square` returns `image/gif` with N frames
  (extend existing `cards-api.test.ts`).
- Manual: `wrangler dev` → fetch the 9 cards → visually confirm.

## Out of scope

- Client-side WebGL / true GLSL (CPU only, per user).
- Changing the static PNG route.
- Full-background or glow-text layouts (border bands chosen).
