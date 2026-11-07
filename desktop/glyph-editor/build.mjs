import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { resolve, dirname, join } from "node:path";
import { mkdir, copyFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
const home = dirname(fileURLToPath(import.meta.url)),
  root = resolve(home, "../.."),
  app = join(root, "app");
const require = createRequire(join(app, "package.json")),
  { build } = require("esbuild");
const bundle = join(home, "dist/Verba Glyph Editor.app"),
  contents = join(bundle, "Contents"),
  resources = join(contents, "Resources");
await mkdir(join(contents, "MacOS"), { recursive: true });
await mkdir(resources, { recursive: true });
await build({
  entryPoints: [join(home, "ui/editor.ts")],
  bundle: true,
  minify: true,
  target: "es2022",
  format: "iife",
  outfile: join(resources, "editor.js"),
});
for (const file of ["editor.html", "editor.css"])
  await copyFile(join(home, "ui", file), join(resources, file));
await writeFile(
  join(resources, "configuration.json"),
  JSON.stringify({ corpusRoot: app }),
);
const UPNG = require("upng-js"),
  iconset = join(home, ".build/GlyphEditor.iconset");
await mkdir(iconset, { recursive: true });
for (const [name, size] of [
  ["icon_16x16", 16],
  ["icon_16x16@2x", 32],
  ["icon_32x32", 32],
  ["icon_32x32@2x", 64],
  ["icon_128x128", 128],
  ["icon_128x128@2x", 256],
  ["icon_256x256", 256],
  ["icon_256x256@2x", 512],
  ["icon_512x512", 512],
  ["icon_512x512@2x", 1024],
]) {
  const pixels = new Uint8Array(size * size * 4),
    scale = size / 16;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const px = Math.floor(x / scale),
        py = Math.floor(y / scale);
      let color = [23, 29, 25, 255];
      if (
        px >= 2 &&
        px <= 13 &&
        py >= 2 &&
        py <= 13 &&
        (px % 3 === 2 || py % 3 === 2)
      )
        color = [54, 68, 53, 255];
      if (
        px + py >= 14 &&
        px + py <= 17 &&
        px >= 4 &&
        px <= 12 &&
        py >= 3 &&
        py <= 11
      )
        color = [212, 183, 110, 255];
      if (px >= 3 && px <= 5 && py >= 10 && py <= 12)
        color = [238, 233, 215, 255];
      pixels.set(color, (y * size + x) * 4);
    }
  await writeFile(
    join(iconset, name + ".png"),
    new Uint8Array(UPNG.encode([pixels.buffer], size, size, 0)),
  );
}
execFileSync("iconutil", [
  "-c",
  "icns",
  iconset,
  "-o",
  join(resources, "VerbaGlyphEditor.icns"),
]);
await writeFile(
  join(contents, "Info.plist"),
  `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>org.verbacorpus.glyph-editor</string><key>CFBundleName</key><string>Verba Glyph Editor</string><key>CFBundleDisplayName</key><string>Редактор гліфів Verba</string><key>CFBundleExecutable</key><string>VerbaGlyphEditor</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleShortVersionString</key><string>0.5.0</string><key>CFBundleVersion</key><string>5</string><key>CFBundleIconFile</key><string>VerbaGlyphEditor</string><key>LSMinimumSystemVersion</key><string>14.0</string><key>NSHighResolutionCapable</key><true/><key>NSPrincipalClass</key><string>NSApplication</string></dict></plist>`,
);
execFileSync(
  "swiftc",
  [
    "-O",
    "-target",
    process.arch === "arm64"
      ? "arm64-apple-macosx14.0"
      : "x86_64-apple-macosx14.0",
    "-swift-version",
    "5",
    "-framework",
    "Cocoa",
    "-framework",
    "WebKit",
    "-framework",
    "Network",
    "-o",
    join(contents, "MacOS/VerbaGlyphEditor"),
    ...["Store.swift", "PreviewServer.swift", "main.swift"].map((f) =>
      join(home, "Sources", f),
    ),
  ],
  { stdio: "inherit" },
);
console.log(bundle);
