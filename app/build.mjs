import { build } from "esbuild";
import { mkdir } from "node:fs/promises";

await mkdir("public/data", { recursive: true });
await build({
  entryPoints: ["src/client/main.ts"],
  bundle: true, minify: true, sourcemap: true,
  format: "esm", target: ["es2022"],
  outfile: "public/app.js",
  loader: { ".ttf": "binary" },
});
// Standalone chrome (language switcher) for the static pages (about/api).
await build({
  entryPoints: ["src/client/chrome.ts"],
  bundle: true, minify: true, sourcemap: true,
  format: "esm", target: ["es2022"],
  outfile: "public/chrome.js",
});
console.log("Built public/app.js + public/chrome.js");
