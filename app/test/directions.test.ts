import { describe, it, expect } from "vitest";
import { directionRoute } from "../src/shared/directions";
import { parseLang } from "../src/shared/i18n";

const route = (path: string, host = "verbacorpus.org", method = "GET") => {
  const url = new URL(`https://${host}${path}`);
  const { lang, rest } = parseLang(url.pathname);
  return directionRoute(url, lang, rest, method);
};

describe("Verba umbrella routing", () => {
  it("opens the lightweight catalog at the root", () => expect(route("/")).toEqual({ asset: "/corpora" }));
  it("preserves legacy query filters and locale", () => {
    expect(route("/?q=word&cat=wisdom_folly&sem=1")).toEqual({ redirect: "/pro/?q=word&cat=wisdom_folly&sem=1" });
    expect(route("/en/?src=Franko1901")).toEqual({ redirect: "/en/pro/?src=Franko1901" });
    expect(route("/?utm_source=telegram")).toEqual({ asset: "/corpora" });
  });
  it("uses the original proverbal application and translated chrome", () => {
    expect(route("/pro/")).toEqual({ asset: "/", translateProverbs: true });
    expect(route("/en/pro/")).toEqual({ asset: "/", translateProverbs: true });
  });
  it.each(["contra", "re", "para", "non"])("opens %s with and without a trailing slash", prefix => {
    expect(route(`/${prefix}`)).toEqual({ asset: `/${prefix}/` });
    expect(route(`/${prefix}/`)).toEqual({ asset: `/${prefix}/` });
  });
  it.each(["pro", "contra", "re", "para", "non"])("maps the exact %s custom domain", prefix => {
    expect(route("/", `${prefix}.verbacorpus.org`)).toEqual(route(`/${prefix}/`));
    expect(route("/", `${prefix}.verbacorpus.org.example.com`)).toEqual({ asset: "/corpora" });
  });
  it("leaves APIs, webhooks, old links and download paths untouched", () => {
    for (const path of ["/api/v1/meta", "/api/telegram-webhook", "/p/p1", "/s/1", "/card/p1.png", "/bez-tabu/", "/blog/dzherela", "/non/icons/sun.svg"]) expect(route(path)).toBeNull();
    expect(route("/", "verbacorpus.org", "POST")).toBeNull();
    expect(route("/para/", "verbacorpus.org", "HEAD")).toEqual({ asset: "/para/" });
  });
});
