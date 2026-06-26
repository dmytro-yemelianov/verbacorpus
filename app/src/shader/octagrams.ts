// CPU port of "Octagrams" by whisky_shusuky — https://www.shadertoy.com/view/tlVGDt
// Reduced to the accumulated glow field `ac` that drives the vyshyvanka stitch pattern.
// No GPU: this is a plain per-sample software shader. Pure module (no Worker APIs).

// GLSL `v *= rot(a)` is a row-vector × matrix product (mat2(c,s,-s,c)):
//   (x, y) -> (x*c + y*s, -x*s + y*c)
function rotMul(x: number, y: number, a: number): [number, number] {
  const c = Math.cos(a), s = Math.sin(a);
  return [x * c + y * s, -x * s + y * c];
}

// GLSL mod(x,y) = x - y*floor(x/y)  (always within [0,y) for y>0)
function gmod(x: number, y: number): number {
  return x - y * Math.floor(x / y);
}

function sdBox(px: number, py: number, pz: number, bx: number, by: number, bz: number): number {
  const qx = Math.abs(px) - bx, qy = Math.abs(py) - by, qz = Math.abs(pz) - bz;
  const mx = Math.max(qx, 0), my = Math.max(qy, 0), mz = Math.max(qz, 0);
  const outside = Math.sqrt(mx * mx + my * my + mz * mz);
  const inside = Math.min(Math.max(qx, Math.max(qy, qz)), 0);
  return outside + inside;
}

// box(pos, scale): in the original the post-`base` mutations of pos are dead code
// (result = -base), so the meaningful value is just -sdBox(pos*scale, (.4,.4,.1))/1.5.
function box(px: number, py: number, pz: number, scale: number): number {
  return -sdBox(px * scale, py * scale, pz * scale, 0.4, 0.4, 0.1) / 1.5;
}

// box_set: six rotated/offset boxes max-combined; `gTime` drives the breathing motion.
function boxSet(px: number, py: number, pz: number, gTime: number): number {
  const w = Math.sin(gTime * 0.4);
  const sc = 2.0 - Math.abs(w) * 1.5;
  let [x, y] = rotMul(px, py + w * 2.5, 0.8); const b1 = box(x, y, pz, sc);
  [x, y] = rotMul(px, py - w * 2.5, 0.8); const b2 = box(x, y, pz, sc);
  [x, y] = rotMul(px + w * 2.5, py, 0.8); const b3 = box(x, y, pz, sc);
  [x, y] = rotMul(px - w * 2.5, py, 0.8); const b4 = box(x, y, pz, sc);
  [x, y] = rotMul(px, py, 0.8); const b5 = box(x, y, pz, 0.5) * 6.0;
  const b6 = box(px, py, pz, 0.5) * 6.0;
  return Math.max(Math.max(Math.max(Math.max(Math.max(b1, b2), b3), b4), b5), b6);
}

export interface OctagramOpts {
  time?: number;   // scene time (geometry is held static for color-cycle mode)
  steps?: number;  // raymarch iterations
}

// Accumulated glow for one sample at pixel (px,py) of a (W,H) viewport.
export function octagramAc(px: number, py: number, W: number, H: number, time: number, steps: number): number {
  const m = Math.min(W, H);
  let rx = ((px + 0.5) * 2 - W) / m;
  let ry = ((py + 0.5) * 2 - H) / m;
  let rz = 1.5;
  // normalize ray
  const inv = 1 / Math.sqrt(rx * rx + ry * ry + rz * rz);
  rx *= inv; ry *= inv; rz *= inv;
  [rx, ry] = rotMul(rx, ry, Math.sin(time * 0.03) * 5.0);
  [ry, rz] = rotMul(ry, rz, Math.sin(time * 0.05) * 0.2);
  const rox = 0.0, roy = -0.2, roz = time * 4.0;
  let t = 0.1, ac = 0.0;
  for (let i = 0; i < steps; i++) {
    let pxp = rox + rx * t, pyp = roy + ry * t, pzp = roz + rz * t;
    pxp = gmod(pxp - 2, 4) - 2; pyp = gmod(pyp - 2, 4) - 2; pzp = gmod(pzp - 2, 4) - 2;
    const gTime = time - i * 0.01;
    let d = boxSet(pxp, pyp, pzp, gTime);
    d = Math.max(Math.abs(d), 0.01);
    ac += Math.exp(-d * 23.0);
    t += d * 0.55;
  }
  return ac;
}

// Sample the field on a gw×gh grid, normalized to [0,1] (by the grid's own max).
export function octagramField(gw: number, gh: number, opts: OctagramOpts = {}): Float32Array {
  const time = opts.time ?? 3.5;
  const steps = opts.steps ?? 60;
  const out = new Float32Array(gw * gh);
  let max = 1e-6;
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const v = octagramAc(x, y, gw, gh, time, steps);
      out[y * gw + x] = v;
      if (v > max) max = v;
    }
  }
  for (let i = 0; i < out.length; i++) out[i] = out[i] / max;
  return out;
}
