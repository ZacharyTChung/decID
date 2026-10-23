/**
 * npm run site:product: builds the hosted decID prototype into site/product/dist/:
 *
 *   index.html   the page as published (an Artifact: body content only, CSS inlined)
 *   app.js       the bundle: React UI + decID's own src/ modules + the compiled contracts
 *   local.html   the same page with a document skeleton, for local testing (npm run test:product-site)
 *
 * Needs `npm run compile` first (the contracts' bytecode is bundled).
 */
import { build } from "esbuild";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

const ROOT = process.cwd();
const HERE = path.join(ROOT, "site", "product");
const DIST = path.join(HERE, "dist");
const STUBS = path.join(ROOT, "site", "stubs");
rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

const unavailable = path.join(STUBS, "node-unavailable.js");
const result = await build({
  entryPoints: [path.join(HERE, "app.tsx")],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["chrome120", "firefox121", "safari17"],
  jsx: "automatic",
  minify: true,
  sourcemap: false,
  outfile: path.join(DIST, "app.js"),
  inject: [path.join(STUBS, "buffer-global.js")],
  alias: {
    "server-only": path.join(STUBS, "server-only.js"),
    "next/link": path.join(HERE, "stubs", "next-link.tsx"),
    "next/navigation": path.join(HERE, "stubs", "next-navigation.ts"),
    "node:fs": unavailable,
    "node:path": unavailable,
  },
  define: { "process.env.NODE_ENV": '"production"' },
  legalComments: "none",
  metafile: true,
  logLevel: "warning",
});

const cssIn = path.join(HERE, "styles.css");
const css = (await postcss([tailwind({ base: ROOT, optimize: { minify: true } })]).process(readFileSync(cssIn, "utf8"), { from: cssIn })).css;

const head = `<title>decID</title>
<meta name="description" content="Prove you're 21. Nothing else. A working prototype of reusable, privacy-preserving age verification.">
<style>${css}</style>`;
const body = `<div id="root"></div>
<noscript>decID needs JavaScript: the whole prototype runs in this page.</noscript>
<script type="module" src="app.js"></script>`;
writeFileSync(path.join(DIST, "index.html"), `${head}\n${body}\n`);
writeFileSync(path.join(DIST, "local.html"), `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${head}</head><body>${body}</body></html>\n`);

const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;
const js = Object.values(result.metafile.outputs).reduce((a, o) => a + o.bytes, 0);
console.log(`site/product/dist built: app.js ${kb(js)}, CSS ${kb(css.length)}`);
