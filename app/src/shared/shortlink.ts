const ID_RE = /^p(\d+)$/;

export function toShort(id: string): string {
  const m = id.match(ID_RE);
  return m ? String(parseInt(m[1], 10)) : id;
}

export function fromShort(code: string, count: number): string | null {
  if (!/^[1-9]\d*$/.test(code)) return null; // digits, no leading zero, not "0"
  const n = parseInt(code, 10);
  if (n < 1 || n > count) return null;
  return "p" + String(n).padStart(6, "0");
}

export function shortUrl(id: string, host: string): string {
  return `https://${host}/s/${toShort(id)}`;
}
