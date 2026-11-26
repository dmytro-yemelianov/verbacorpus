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
await import("./build_corpora.mjs");
// Compile the early inline listener separately: stringifying a Worker-bundled
// function would leave references to esbuild's server-side naming helpers.
const diagnostics = await build({
  stdin: { contents: 'import { installDiagnostics } from "./src/client/diagnostics"; installDiagnostics();', resolveDir: import.meta.dirname },
  bundle: true, minify: true, format: 'iife', target: ['es2022'], write: false,
});
await writeFile('content/diagnostics-bootstrap.json', JSON.stringify(diagnostics.outputFiles[0].text) + '\n');
await build({ entryPoints: ["src/client/site-shell.ts"], bundle: true, minify: true,
  format: "iife", target: ["es2022"], outfile: "public/site-shell.js" });
await build({
  entryPoints: ["src/client/umbrella.ts"], bundle: true, minify: true,
  format: "esm", target: ["es2022"], outfile: "public/umbrella.js",
});
await build({
  entryPoints: ["src/client/bez-tabu.ts"],
  bundle: true, minify: true, sourcemap: true,
  format: "esm", target: ["es2022"],
  outfile: "public/bez-tabu/app.js",
});
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
console.log(`Built public/app.js + public/chrome.js (commit: ${commitHash || "none"})`);
