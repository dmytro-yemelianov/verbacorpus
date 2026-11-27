import type { Proverb } from "./shared/corpus";
import { prettify } from "./shared/text";
import { srcLabel } from "./shared/sources";
import { cardPhotoUrl } from "./telegram";

export interface InstagramConfig {
  accountId: string;
  accessToken: string;
  apiVersion?: string;
}

export interface PostToInstagramOptions {
  config: InstagramConfig;
  imageUrl: string;
  caption?: string;
  mediaType?: "IMAGE" | "STORIES";
  fetchImpl?: typeof fetch;
}

export function formatInstagramCaption(proverb: Proverb, newsSource?: { title: string; source: string }): string {
  const pt = prettify(proverb.text);
  const pm = proverb.modern_text && proverb.modern_text.trim() !== proverb.text.trim() ? `\n(${prettify(proverb.modern_text)})` : "";
  const sources = proverb.sources.map(srcLabel).join(", ");

  let caption = `💬 «${pt}»${pm}\n\n`;
  if (newsSource) {
    caption += `📰 До теми: ${newsSource.title} (${newsSource.source})\n\n`;
  }
  if (sources) {
    caption += `📖 Джерело: ${sources}\n\n`;
  }
  caption += `🇺🇦 verba — відкритий корпус українських прислів'їв та приказок.\n`;
  caption += `🔗 verbacorpus.org\n\n`;
  caption += `#українськамова #прислів_я #мудрість #фольклор #україна #мова #verba`;
  return caption;
}

export async function createInstagramMediaContainer(
  config: InstagramConfig,
  imageUrl: string,
  caption?: string,
  mediaType: "IMAGE" | "STORIES" = "IMAGE",
  fetchImpl: typeof fetch = fetch
): Promise<string> {
  const apiVer = config.apiVersion || "v19.0";
  const url = `https://graph.facebook.com/${apiVer}/${encodeURIComponent(config.accountId)}/media`;

  const body: Record<string, string> = {
    image_url: imageUrl,
    access_token: config.accessToken,
  };
  if (mediaType === "STORIES") {
    body.media_type = "STORIES";
  } else if (caption) {
    body.caption = caption;
  }

  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Instagram container creation failed (${res.status}): ${err}`);
  }

  const json = (await res.json()) as { id: string };
  return json.id;
}

export async function publishInstagramMediaContainer(
  config: InstagramConfig,
  creationId: string,
  fetchImpl: typeof fetch = fetch
): Promise<string> {
  const apiVer = config.apiVersion || "v19.0";
  const url = `https://graph.facebook.com/${apiVer}/${encodeURIComponent(config.accountId)}/media_publish`;

  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      creation_id: creationId,
      access_token: config.accessToken,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Instagram media publish failed (${res.status}): ${err}`);
  }

  const json = (await res.json()) as { id: string };
  return json.id;
}

export async function postToInstagram(options: PostToInstagramOptions): Promise<{ id: string }> {
  const fetcher = options.fetchImpl || fetch;
  const containerId = await createInstagramMediaContainer(
    options.config,
    options.imageUrl,
    options.caption,
    options.mediaType ?? "IMAGE",
    fetcher
  );

  const mediaId = await publishInstagramMediaContainer(
    options.config,
    containerId,
    fetcher
  );

  return { id: mediaId };
}

export async function crosspostProverbToInstagram(
  env: { INSTAGRAM_ACCOUNT_ID?: string; INSTAGRAM_ACCESS_TOKEN?: string; VERBA_API_BASE?: string },
  proverb: Proverb,
  options?: { newsSource?: { title: string; source: string }; format?: "square" | "story"; fetchImpl?: typeof fetch }
): Promise<{ id?: string; error?: string }> {
  if (!env.INSTAGRAM_ACCOUNT_ID || !env.INSTAGRAM_ACCESS_TOKEN) {
    return { error: "Instagram credentials not configured" };
  }

  const format = options?.format ?? "square";
  const imageUrl = cardPhotoUrl(env, proverb.id, format);
  const caption = format === "square" ? formatInstagramCaption(proverb, options?.newsSource) : undefined;

  try {
    const result = await postToInstagram({
      config: {
        accountId: env.INSTAGRAM_ACCOUNT_ID,
        accessToken: env.INSTAGRAM_ACCESS_TOKEN,
      },
      imageUrl,
      caption,
      mediaType: format === "story" ? "STORIES" : "IMAGE",
      fetchImpl: options?.fetchImpl,
    });
    return { id: result.id };
  } catch (err: any) {
    console.error("Instagram crosspost failed:", err);
    return { error: err?.message || String(err) };
  }
}
