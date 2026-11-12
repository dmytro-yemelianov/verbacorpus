import worker from "./index";
import type { SubtleCrypto as WorkersSubtleCrypto } from "@cloudflare/workers-types";

type PreviewEnv = Parameters<typeof worker.fetch>[1] & { PREVIEW_PASSWORD?: string };

// A separate entry point keeps preview authentication out of production routing.
export default {
  async fetch(request: Request, env: PreviewEnv, ctx: ExecutionContext): Promise<Response> {
    const authorization = request.headers.get("authorization") ?? "";
    const expected = env.PREVIEW_PASSWORD ? `Basic ${btoa(`preview:${env.PREVIEW_PASSWORD}`)}` : "";
    const encoder = new TextEncoder();
    const [actualHash, expectedHash] = await Promise.all([
      crypto.subtle.digest("SHA-256", encoder.encode(authorization)),
      crypto.subtle.digest("SHA-256", encoder.encode(expected)),
    ]);
    if (!expected || !(crypto.subtle as WorkersSubtleCrypto).timingSafeEqual(actualHash, expectedHash)) {
      return new Response(request.method === "HEAD" ? null : "Private Verba preview", {
        status: 401,
        headers: {
          "www-authenticate": 'Basic realm="Verba preview", charset="UTF-8"',
          "cache-control": "private, no-store",
          "x-robots-tag": "noindex, nofollow",
          "vary": "Authorization",
        },
      });
    }

    let response: Response;
    if (new URL(request.url).pathname === "/sw.js") {
      // Do not retain private preview content in the production offline cache.
      response = new Response("self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',event=>event.waitUntil(self.registration.unregister()));", {
        headers: { "content-type": "application/javascript; charset=utf-8" },
      });
    } else {
      const forwarded = new Request(request);
      forwarded.headers.delete("authorization");
      response = await worker.fetch(forwarded, env, ctx);
    }
    const privateResponse = new Response(response.body, response);
    privateResponse.headers.set("cache-control", "private, no-store");
    privateResponse.headers.set("x-robots-tag", "noindex, nofollow");
    privateResponse.headers.append("vary", "Authorization");
    return privateResponse;
  },
};
