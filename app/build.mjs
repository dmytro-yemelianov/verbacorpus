import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { execSync } from "node:child_process";

let commitHash = "";
try {
  commitHash = execSync("git rev-parse --short HEAD").toString().trim();
} catch (e) {
  console.warn("Could not get git commit hash:", e.message);
}

await mkdir("public/data", { recursive: true });
await build({
  entryPoints: ["src/client/main.ts"],
  bundle: true, minify: true, sourcemap: true,
  format: "esm", target: ["es2022"],
  outfile: "public/app.js",
  loader: { ".ttf": "binary" },
  define: {
    __COMMIT_HASH__: JSON.stringify(commitHash),
  },
});
// Standalone chrome (language switcher) for the static pages (about/api).
await build({
  entryPoints: ["src/client/chrome.ts"],
  bundle: true, minify: true, sourcemap: true,
  format: "esm", target: ["es2022"],
  outfile: "public/chrome.js",
  define: {
    __COMMIT_HASH__: JSON.stringify(commitHash),
  },
});
// Generate embroidery.css (themeable рушник bands) from the UPA motif corpus.
// Bundle the TS generator in-memory, import it as a data: URL, write its output.
const embRes = await build({
  entryPoints: ["src/embroidery-css.ts"],
  bundle: true, format: "esm", write: false, sourcemap: false,
});
const embMod = await import(
  "data:text/javascript;base64," + Buffer.from(embRes.outputFiles[0].text).toString("base64")
);
await writeFile("public/embroidery.css", embMod.embroideryCss());
console.log("Built public/embroidery.css");
console.log(`Built public/app.js + public/chrome.js (commit: ${commitHash || "none"})`);
