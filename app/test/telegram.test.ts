import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect, vi } from "vitest";
import worker from "../src/index";

async function callWebhook(secretHeader?: string, tokenConfigured = true, webhookSecretConfigured = true) {
  const ctx = createExecutionContext();
  const testEnv = {
    ...env,
    TELEGRAM_BOT_TOKEN: tokenConfigured ? "12345:mock_token" : undefined,
    TELEGRAM_WEBHOOK_SECRET: webhookSecretConfigured ? "super_secret" : undefined,
  };
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (secretHeader !== undefined) {
    headers["x-telegram-bot-api-secret-token"] = secretHeader;
  }
  
  const request = new Request("https://verbacorpus.org/api/telegram-webhook", {
    method: "POST",
    headers,
    body: JSON.stringify({
      update_id: 10000,
      message: {
        message_id: 1,
        date: 1441645532,
        chat: {
          id: 1111111,
          type: "private",
          first_name: "Test",
        },
        text: "/start",
      },
    }),
  });
  
  const res = await worker.fetch(request, testEnv as any, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

describe("Telegram Bot Integration", () => {
  it("fails with 500 if token is missing", async () => {
    const res = await callWebhook(undefined, false, false);
    expect(res.status).toBe(500);
    expect(await res.text()).toBe("Telegram Bot Token is not configured");
  });

  it("fails with 403 if secret header is incorrect", async () => {
    const res = await callWebhook("wrong_secret", true, true);
    expect(res.status).toBe(403);
    expect(await res.text()).toBe("Unauthorized");
  });

  it("succeeds (200) with correct secret header", async () => {
    const res = await callWebhook("super_secret", true, true);
    expect(res.status).toBe(200);
  });

  it("/news is refused for non-admin users (admin gate)", async () => {
    // Stub global fetch so grammy's Telegram API calls (e.g. ctx.reply -> sendMessage)
    // are intercepted and answered with a 200 { ok: true } instead of hitting the real
    // API with the fake test token. Telegram requests are captured so we can assert the
    // bot replied with the admin-only refusal; all other URLs fall through to real fetch.
    const calls: Array<{ url: string; body: any }> = [];
    const realFetch = globalThis.fetch;
    const mockFetch = vi.fn(async (input: any, init?: any) => {
      const url = typeof input === "string" ? input : input.url;
      if (typeof url === "string" && url.includes("api.telegram.org")) {
        let body: any = undefined;
        if (init?.body) {
          try { body = JSON.parse(init.body as string); } catch { body = init.body; }
        }
        calls.push({ url, body });
        return new Response(JSON.stringify({ ok: true, result: {} }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return realFetch(input, init);
    });
    vi.stubGlobal("fetch", mockFetch);
    try {
      const ctx = createExecutionContext();
      const testEnv = {
        ...env,
        TELEGRAM_BOT_TOKEN: "12345:mock_token",
        TELEGRAM_WEBHOOK_SECRET: "super_secret",
      };
      const update = {
        update_id: 2,
        message: {
          message_id: 1,
          date: 0,
          chat: { id: 999, type: "private" },
          from: { id: 999, is_bot: false, first_name: "x" },
          text: "/news",
          // entities make grammy actually dispatch the /news command handler.
          entities: [{ type: "bot_command", offset: 0, length: 5 }],
        },
      };
      const request = new Request("https://verbacorpus.org/api/telegram-webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-telegram-bot-api-secret-token": "super_secret",
        },
        body: JSON.stringify(update),
      });
      const res = await worker.fetch(request, testEnv as any, ctx);
      await waitOnExecutionContext(ctx);
      expect(res.status).toBe(200);
      // The admin gate fired: the bot answered with the refusal, never drafting news.
      const sendMessage = calls.find((c) => c.url.includes("/sendMessage"));
      expect(sendMessage).toBeDefined();
      expect(sendMessage!.body.chat_id).toBe(999);
      expect(String(sendMessage!.body.text)).toContain("лише для адміністратора");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("news:* approval callback is refused for non-admin users (no channel post)", async () => {
    // Same fetch-stub pattern: capture Telegram API calls so we can assert the admin
    // gate answered the callback but never posted to the channel (no sendPhoto).
    const calls: Array<{ url: string; body: any }> = [];
    const realFetch = globalThis.fetch;
    const mockFetch = vi.fn(async (input: any, init?: any) => {
      const url = typeof input === "string" ? input : input.url;
      if (typeof url === "string" && url.includes("api.telegram.org")) {
        let body: any = undefined;
        if (init?.body) {
          try { body = JSON.parse(init.body as string); } catch { body = init.body; }
        }
        calls.push({ url, body });
        return new Response(JSON.stringify({ ok: true, result: {} }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return realFetch(input, init);
    });
    vi.stubGlobal("fetch", mockFetch);
    try {
      const ctx = createExecutionContext();
      const testEnv = {
        ...env,
        TELEGRAM_BOT_TOKEN: "12345:mock_token",
        TELEGRAM_WEBHOOK_SECRET: "super_secret",
      };
      const update = {
        update_id: 3,
        callback_query: {
          id: "1",
          from: { id: 999, is_bot: false, first_name: "x" },
          message: { message_id: 1, date: 0, chat: { id: 999, type: "private" } },
          chat_instance: "1",
          data: "news:abc:0",
        },
      };
      const request = new Request("https://verbacorpus.org/api/telegram-webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-telegram-bot-api-secret-token": "super_secret",
        },
        body: JSON.stringify(update),
      });
      const res = await worker.fetch(request, testEnv as any, ctx);
      await waitOnExecutionContext(ctx);
      expect(res.status).toBe(200);
      // Admin gate fired: callback answered, but nothing posted to the channel.
      const sendPhoto = calls.find((c) => c.url.includes("/sendPhoto"));
      expect(sendPhoto).toBeUndefined();
      const answer = calls.find((c) => c.url.includes("/answerCallbackQuery"));
      expect(answer).toBeDefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
