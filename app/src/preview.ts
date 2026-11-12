import worker from "./index";

type PreviewEnv = Parameters<typeof worker.fetch>[1];

// Keep preview indexing and offline-cache policy separate from production routing.
export default {
  async fetch(request: Request, env: PreviewEnv, ctx: ExecutionContext): Promise<Response> {
    let response: Response;
    if (new URL(request.url).pathname === "/sw.js") {
      // Always show the latest preview instead of the production offline cache.
      response = new Response("self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',event=>event.waitUntil(self.registration.unregister()));", {
        headers: { "content-type": "application/javascript; charset=utf-8" },
      });
    } else {
      const forwarded = new Request(request);
      forwarded.headers.delete("authorization");
      response = await worker.fetch(forwarded, env, ctx);
    }
    const previewResponse = new Response(response.body, response);
    previewResponse.headers.set("cache-control", "no-store");
    previewResponse.headers.set("x-robots-tag", "noindex, nofollow");
    return previewResponse;
  },
};
