import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect } from "vitest";
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
});
