import { CorpusError, limits } from "./corpus";
export const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, HEAD, POST, OPTIONS",
  "access-control-allow-headers": "Content-Type, If-None-Match",
  "access-control-expose-headers": "ETag, X-Corpus-Snapshot, Link",
  "access-control-max-age": "600",
};
export function json(
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=300",
      ...cors,
      ...headers,
    },
  });
}
export function problem(error: unknown) {
  if (error instanceof CorpusError)
    return json(
      { error: { code: error.code, message: error.message } },
      error.status,
      { "cache-control": "no-store" },
    );
  console.error(
    JSON.stringify({
      event: "para_api_failure",
      message: error instanceof Error ? error.message : "Unknown error",
    }),
  );
  return json(
    {
      error: {
        code: "CORPUS_UNAVAILABLE",
        message: "The font corpus is temporarily unavailable",
      },
    },
    503,
    { "cache-control": "no-store" },
  );
}
export async function boundedText(request: Request): Promise<string> {
  const size = request.headers.get("content-length");
  if (size && Number(size) > limits.queryBytes)
    throw new CorpusError("REQUEST_TOO_LARGE", "Request exceeds 32 KiB", 413);
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limits.queryBytes) {
        await reader.cancel();
        throw new CorpusError(
          "REQUEST_TOO_LARGE",
          "Request exceeds 32 KiB",
          413,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(
    bytes,
  );
}
export function matchesEtag(request: Request, etag: string) {
  return (
    request.headers
      .get("if-none-match")
      ?.split(",")
      .map((v) => v.trim().replace(/^W\//, ""))
      .some((v) => v === etag || v === "*") ?? false
  );
}
