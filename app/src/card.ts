import { ImageResponse } from "workers-og";
import { ptSerifBase64 } from "./fonts/ptserif";
import { type CardModel } from "./shared/meta";

const FONT = Uint8Array.from(atob(ptSerifBase64), (c) => c.charCodeAt(0)).buffer;

// satori/workers-og renders text literally and does NOT decode HTML entities,
// so escape only the structural chars; leave quotes/apostrophes as-is.
const e = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));

function cleanForCard(s: string): string {
  if (!s) return s;
  return s
    .replace(/\u043e\u0302/g, "\u00f4")
    .replace(/\u041e\u0302/g, "\u00d4")
    .replace(/\u0456\u0302/g, "\u00ee")
    .replace(/\u0406\u0302/g, "\u00ce")
    .replace(/\u0302/g, "")
    .replace(/\u0301/g, "");
}

// Band height (px) reserved at the top and bottom for the vyshyvanka pattern,
// as a fraction of the card height. Shared by the layer padding and the GIF painter.
export function bandPx(height: number): number {
  return Math.round(height * 0.12);
}

export function renderCard(m: CardModel, opts: { format?: string; state?: number; layer?: boolean; transparent?: boolean; minimal?: boolean; nochrome?: boolean } = {}): Response {
  const format = opts.format || "fb";
  const layer = !!opts.layer;
  const bg = opts.transparent ? "transparent" : "#f4f1e8";
  const text = cleanForCard(m.text);

  let width = 1200;
  let height = 630;
  let html = "";

  const escapedText = e(text);
  const escapedUrl = e((m.shortUrl || "").replace(/^https?:\/\//, ""));
  // QR with the URL stacked beneath it, both the same width (no source/№ line).
  const qrCol = (size: number) =>
    `<div style="display:flex;flex-direction:column;align-items:center;width:${size}px;">` +
    `<img src="${m.qr}" width="${size}" height="${size}" style="display:flex;" />` +
    `<div style="display:flex;justify-content:center;width:${size}px;margin-top:8px;font-size:${Math.floor(size/12)}px;color:#6f6a5c;letter-spacing:.01em;">${escapedUrl}</div>` +
    `</div>`;

  if (format === "square") {
    width = 1080;
    height = 1080;
    html = `<div style="display:flex;flex-direction:column;width:1080px;height:1080px;background:${bg};padding:${layer ? bandPx(1080) + 40 : 90}px 90px;font-family:'PT Serif';justify-content:space-between;">
      <div style="display:flex;flex-direction:column;flex:1;justify-content:center;">
        <div style="font-size:70px;color:#232520;line-height:1.2;display:flex;flex-wrap:wrap;">
          <span>${escapedText}</span>
        </div>
      </div>
      <div style="display:flex;justify-content:flex-end;">${qrCol(144)}</div>
    </div>`;
  } else if (format === "story") {
    width = 1080;
    height = 1920;
    html = `<div style="display:flex;flex-direction:column;width:1080px;height:1920px;background:${bg};padding:${layer ? bandPx(1920) + 50 : 100}px 80px;font-family:'PT Serif';justify-content:space-between;align-items:center;">
      <div style="display:flex;flex-direction:column;flex:1;justify-content:center;align-items:center;text-align:center;">
        <div style="font-size:72px;color:#232520;line-height:1.28;display:flex;text-align:center;justify-content:center;flex-wrap:wrap;">
          <span>${escapedText}</span>
        </div>
      </div>
      <div style="display:flex;justify-content:center;margin-top:60px;">${qrCol(180)}</div>
    </div>`;
  } else if (format === "yt") {
    width = 1280;
    height = 720;
    html = `<div style="display:flex;flex-direction:column;width:1280px;height:720px;background:${bg};padding:${layer ? bandPx(720) + 30 : 80}px 80px;font-family:'PT Serif';">
      <div style="display:flex;flex-direction:column;flex:1;justify-content:center;">
        <div style="font-size:64px;color:#232520;line-height:1.2;display:flex;flex-wrap:wrap;">
          <span>${escapedText}</span>
        </div>
      </div>
      <div style="display:flex;justify-content:flex-end;">${qrCol(132)}</div>
    </div>`;
  } else if (format === "sticker") {
    // 512×512 Telegram sticker: big centered proverb on linen, рушник bands via the
    // shader compositor (makeVyshyvankaPng). No QR / footer / source — sticker spec.
    width = 512;
    height = 512;
    html = `<div style="display:flex;width:512px;height:512px;background:${bg};padding:${layer ? bandPx(512) + 22 : 40}px 34px;font-family:'PT Serif';align-items:center;justify-content:center;text-align:center;">
      <div style="font-size:46px;color:#232520;line-height:1.22;display:flex;flex-wrap:wrap;justify-content:center;text-align:center;font-weight:normal;">
        <span>${escapedText}</span>
      </div>
    </div>`;
  } else if (format === "telegram") {
    width = 1200;
    height = 630;
    html = `<div style="display:flex;flex-direction:column;width:1200px;height:630px;background:${bg};padding:${layer ? bandPx(630) + 30 : 80}px 80px 70px 80px;font-family:'PT Serif';justify-content:space-between;">
      <div style="display:flex;flex-direction:column;flex:1;justify-content:center;">
        <div style="font-size:62px;color:#232520;line-height:1.24;display:flex;flex-wrap:wrap;font-weight:normal;margin-bottom:40px;">
          <span>${escapedText}</span>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;border-top:2px solid #e5dfcf;padding-top:22px;">
        <div style="display:flex;align-items:center;">
          <svg viewBox="0 0 40 64" style="width:24px;height:38px;margin-right:12px;display:flex;"><path d="M20 4 C 31 22 30 46 21 60 C 12 46 11 22 20 4 Z" fill="#5e7355"/><path d="M20 11 C 23 28 22 47 21 54" stroke="#f4f1e8" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>
          <span style="font-size:28px;color:#5e7355;font-weight:bold;letter-spacing:0.02em;">verba</span>
          <span style="font-size:24px;color:#8a8270;margin-left:16px;">verbacorpus.org · @VerbaCorpus</span>
        </div>
        <div style="display:flex;font-size:22px;color:#6f6a5c;line-height:1.35;letter-spacing:.01em;margin-top:14px;">
          <span>${e(m.cite)}</span>
        </div>
      </div>
    </div>`;
  } else {
    // Default fb
    html = `<div style="display:flex;flex-direction:column;width:1200px;height:630px;background:${bg};padding:${layer ? bandPx(630) + 30 : 72}px 72px;font-family:'PT Serif';">
      <div style="display:flex;flex-direction:column;flex:1;justify-content:center;">
        <div style="font-size:62px;color:#232520;line-height:1.18;display:flex;flex-wrap:wrap;">
          <span>${escapedText}</span>
        </div>
      </div>
      <div style="display:flex;justify-content:flex-end;">${qrCol(132)}</div>
    </div>`;
  }

  return new ImageResponse(html, {
    width,
    height,
    fonts: [{ name: "PT Serif", data: FONT, weight: 400, style: "normal" }],
  });
}
