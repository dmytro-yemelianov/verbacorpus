import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";

export const PREFIXES = ["pro", "contra", "re", "para", "non"];
export const escape = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const sha256 = raw => createHash("sha256").update(raw).digest("hex");

export function validateRegistry(entries) {
  if (entries.length !== PREFIXES.length || new Set(entries.map(e => e.prefix)).size !== PREFIXES.length) throw new Error("Expected five unique Verba directions");
  for (const prefix of PREFIXES) {
    const entry = entries.find(e => e.prefix === prefix);
    if (!entry || entry.href !== `/${prefix}/` || entry.domain !== `${prefix}.verbacorpus.org`) throw new Error(`Invalid direction: ${prefix}`);
    if (!["corpus", "editorial", "collections"].includes(entry.kind)) throw new Error(`Invalid kind: ${prefix}`);
  }
  for (const entry of entries) if (entry.repository && !entry.repository.startsWith("https://github.com/")) throw new Error("Invalid repository URL");
  return entries;
}

export function validateIcon(icon) {
  if (!/^[a-z][a-z0-9-]+$/.test(icon.id) || icon.rows.length !== 16 || icon.rows.some(r => r.length !== 16 || /[^.XR]/.test(r))) throw new Error(`Invalid 16x16 icon: ${icon.id}`);
  return icon;
}

export function iconSvg(icon) {
  validateIcon(icon);
  const cells = icon.rows.flatMap((row, y) => [...row].flatMap((c, x) => c === "." ? [] : [`<rect x="${x}" y="${y}" width="1" height="1" fill="${c === "R" ? "#b4232a" : "#292b26"}"/>`])).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" shape-rendering="crispEdges" role="img"><title>${escape(icon.title)}</title><metadata>Verba Corpus · CC BY 4.0 · ${escape(icon.id)} · original pixel icon</metadata>${cells}</svg>`;
}
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) { c ^= b; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0); }
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type), size = Buffer.alloc(4), crc = Buffer.alloc(4);
  size.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([size, name, data, crc]);
}
export function iconPng(icon, scale = 8) {
  validateIcon(icon);
  if (!Number.isInteger(scale) || scale < 1 || scale > 32) throw new Error("Invalid integer icon scale");
  const size = 16 * scale, raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const c = icon.rows[Math.floor(y / scale)][Math.floor(x / scale)];
    const rgba = c === "." ? [0, 0, 0, 0] : c === "R" ? [180, 35, 42, 255] : [41, 43, 38, 255];
    raw.set(rgba, y * (1 + size * 4) + 1 + x * 4);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
