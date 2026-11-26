import { createHash } from "node:crypto";

export const PREFIXES = ["pro", "contra", "re", "para", "non"];
export const escape = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const sha256 = raw => createHash("sha256").update(raw).digest("hex");

export function validateRegistry(entries) {
  if (entries.length !== PREFIXES.length || new Set(entries.map(e => e.prefix)).size !== PREFIXES.length) throw new Error("Expected five unique Verba directions");
  for (const prefix of PREFIXES) {
    const entry = entries.find(e => e.prefix === prefix);
    if (!entry || entry.href !== `https://${prefix}.verbacorpus.org/` || entry.domain !== `${prefix}.verbacorpus.org`) throw new Error(`Invalid direction: ${prefix}`);
    if (!["corpus", "editorial", "collections"].includes(entry.kind)) throw new Error(`Invalid kind: ${prefix}`);
  }
  for (const entry of entries) if (entry.repository && !entry.repository.startsWith("https://github.com/")) throw new Error("Invalid repository URL");
  return entries;
}
