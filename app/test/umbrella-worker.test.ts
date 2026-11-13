import { it, expect } from "vitest";
import worker from "../src/index";

it("serves the umbrella through ASSETS without fetching proverb data", async () => {
  const seen: string[] = [];
  const env = { ASSETS: { fetch: async (request: Request) => {
    seen.push(new URL(request.url).pathname);
    return new Response("<html lang=uk><h1>Verba Corpus</h1></html>", { headers: { "content-type": "text/html" } });
  } } };
  const response = await worker.fetch(new Request("https://verbacorpus.org/"), env as any);
  expect(response.status).toBe(200);
  expect(seen).toEqual(["/corpora"]);
});

it("redirects a legacy search preserving the complete query", async () => {
  const response = await worker.fetch(new Request("https://verbacorpus.org/?q=%D1%81%D0%BB%D0%BE%D0%B2%D0%BE&src=Nomis1864"), {} as any);
  expect(response.status).toBe(307);
  expect(response.headers.get("location")).toBe("https://verbacorpus.org/pro/?q=%D1%81%D0%BB%D0%BE%D0%B2%D0%BE&src=Nomis1864");
});
