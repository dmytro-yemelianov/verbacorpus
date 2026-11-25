import { describe, expect, it } from "vitest";
import type { Adapter } from "../src/adapters/types.js";
import { API_BASE } from "../src/contract.js";

// Shared behavioural contract every corpus adapter must satisfy.
export function runContractSuite(name: string, make: () => Adapter, knownLocalId: string) {
  describe(`contract: ${name}`, () => {
    it("lists items in the shared shape", async () => {
      const a = make();
      const { items } = await a.list(2, 0, new URLSearchParams());
      expect(items).toHaveLength(2);
      for (const item of items) {
        expect(item.id).toMatch(new RegExp(`^${a.corpus}:.+`));
        expect(item.corpus).toBe(a.corpus);
        expect(item.title).not.toBe("");
        expect(item.licence.status).toBeTruthy();
        const local = item.id.slice(a.corpus.length + 1);
        expect(item.links.self).toBe(`${API_BASE}/v1/${a.corpus}/items/${encodeURIComponent(local)}`);
      }
    });
    it("gets a known item and returns null for an unknown one", async () => {
      const a = make();
      expect(await a.get(knownLocalId)).not.toBeNull();
      expect(await a.get("no-such")).toBeNull();
    });
    it("reports a positive total", async () => {
      expect((await make().meta()).total).toBeGreaterThan(0);
    });
  });
}
