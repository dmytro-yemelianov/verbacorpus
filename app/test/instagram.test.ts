import { describe, it, expect, vi } from "vitest";
import {
  formatInstagramCaption,
  createInstagramMediaContainer,
  publishInstagramMediaContainer,
  postToInstagram,
  crosspostProverbToInstagram,
} from "../src/instagram";
import type { Proverb } from "../src/shared/corpus";

const SAMPLE_PROVERB: Proverb = {
  id: "p000001",
  text: "По парі пізнати, чим серце кипить.",
  modern_text: "За парою видно, що вариться.",
  sources: ["Nomis1864"],
  category: ["людина"],
  variant_group: "vg_1",
};

describe("Instagram integration", () => {
  it("formats Instagram caption with source and hashtags", () => {
    const caption = formatInstagramCaption(SAMPLE_PROVERB);
    expect(caption).toContain("«По парі пізнати, чим серце кипить.»");
    expect(caption).toContain("За парою видно, що вариться.");
    expect(caption).toContain("Номис");
    expect(caption).toContain("#українськамова");
    expect(caption).toContain("verbacorpus.org");
  });

  it("formats Instagram caption with news context", () => {
    const caption = formatInstagramCaption(SAMPLE_PROVERB, {
      title: "Свіжі новини",
      source: "Укрінформ",
    });
    expect(caption).toContain("📰 До теми: Свіжі новини (Укрінформ)");
  });

  it("creates media container via Meta Graph API", async () => {
    const mockFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("https://graph.facebook.com/v19.0/12345/media");
      const body = JSON.parse(init?.body as string);
      expect(body.image_url).toBe("https://api.verbacorpus.org/card.png");
      expect(body.caption).toBe("Тест");
      expect(body.access_token).toBe("tok_abc");
      return new Response(JSON.stringify({ id: "container_999" }), { status: 200 });
    });

    const id = await createInstagramMediaContainer(
      { accountId: "12345", accessToken: "tok_abc" },
      "https://api.verbacorpus.org/card.png",
      "Тест",
      "IMAGE",
      mockFetch as any
    );
    expect(id).toBe("container_999");
  });

  it("creates story container with STORIES media_type", async () => {
    const mockFetch = vi.fn(async (_url: any, init?: any) => {
      const body = JSON.parse(init?.body as string);
      expect(body.media_type).toBe("STORIES");
      expect(body.caption).toBeUndefined();
      return new Response(JSON.stringify({ id: "container_story" }), { status: 200 });
    });

    const id = await createInstagramMediaContainer(
      { accountId: "12345", accessToken: "tok_abc" },
      "https://api.verbacorpus.org/card.png",
      undefined,
      "STORIES",
      mockFetch as any
    );
    expect(id).toBe("container_story");
  });

  it("publishes media container via Meta Graph API", async () => {
    const mockFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("https://graph.facebook.com/v19.0/12345/media_publish");
      const body = JSON.parse(init?.body as string);
      expect(body.creation_id).toBe("container_999");
      expect(body.access_token).toBe("tok_abc");
      return new Response(JSON.stringify({ id: "media_111" }), { status: 200 });
    });

    const id = await publishInstagramMediaContainer(
      { accountId: "12345", accessToken: "tok_abc" },
      "container_999",
      mockFetch as any
    );
    expect(id).toBe("media_111");
  });

  it("postToInstagram runs both creation and publish steps", async () => {
    const calls: string[] = [];
    const mockFetch = vi.fn(async (url: any) => {
      calls.push(String(url));
      if (String(url).endsWith("/media")) {
        return new Response(JSON.stringify({ id: "c1" }), { status: 200 });
      }
      return new Response(JSON.stringify({ id: "m1" }), { status: 200 });
    });

    const res = await postToInstagram({
      config: { accountId: "acc1", accessToken: "tok1" },
      imageUrl: "https://api.verbacorpus.org/card.png",
      fetchImpl: mockFetch as any,
    });
    expect(res.id).toBe("m1");
    expect(calls).toHaveLength(2);
  });

  it("crosspostProverbToInstagram handles missing credentials gracefully", async () => {
    const res = await crosspostProverbToInstagram({}, SAMPLE_PROVERB);
    expect(res.error).toBe("Instagram credentials not configured");
  });

  it("crosspostProverbToInstagram publishes proverb card", async () => {
    const mockFetch = vi.fn(async (url: any, init?: any) => {
      if (String(url).endsWith("/media")) {
        const body = JSON.parse(init?.body as string);
        expect(body.image_url).toContain("/v1/cards/pro:p000001.png?size=square");
        return new Response(JSON.stringify({ id: "c1" }), { status: 200 });
      }
      return new Response(JSON.stringify({ id: "ig_post_777" }), { status: 200 });
    });

    const res = await crosspostProverbToInstagram(
      { INSTAGRAM_ACCOUNT_ID: "acc1", INSTAGRAM_ACCESS_TOKEN: "tok1" },
      SAMPLE_PROVERB,
      { fetchImpl: mockFetch as any }
    );
    expect(res.id).toBe("ig_post_777");
  });
});
