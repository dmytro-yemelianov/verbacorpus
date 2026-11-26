import { describe, it, expect } from "vitest";

// Live contract smoke test; runs only with GATEWAY set, e.g.
// GATEWAY=https://api.verbacorpus.org npx vitest run test/live.test.ts
const GATEWAY = process.env.GATEWAY;
const CORPORA = ["pro", "non", "para", "contra"] as const;

describe.skipIf(!GATEWAY)("live gateway", () => {
  it("lists four available corpora", async () => {
    const body = (await (await fetch(`${GATEWAY}/v1/corpora`)).json()) as any;
    const byCorpus = Object.fromEntries(body.corpora.map((c: any) => [c.corpus, c]));
    for (const c of CORPORA) expect(byCorpus[c]).toMatchObject({ available: true });
  });

  it.each(CORPORA)("%s serves items and seeded random", async (c) => {
    const items = (await (await fetch(`${GATEWAY}/v1/${c}/items?limit=1`)).json()) as any;
    expect(items.items[0].id).toMatch(new RegExp(`^${c}:`));
    const a = (await (await fetch(`${GATEWAY}/v1/${c}/random?seed=live`)).json()) as any;
    const b = (await (await fetch(`${GATEWAY}/v1/${c}/random?seed=live`)).json()) as any;
    expect(a.items.map((i: any) => i.id)).toEqual(b.items.map((i: any) => i.id));
  });
});
