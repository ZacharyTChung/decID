/**
 * npm run site: builds the showcase site into site/dist/ (index.html, playground.js,
 * screenshots/). The playground bundle contains decID's own src/ modules, the compiled
 * contracts (artifacts/, from `npm run compile`) and site/data/evidence.json (from
 * `npm run site:evidence`). Server-only modules are stubbed: the playground never calls them.
 */
import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

const SITE = path.join(process.cwd(), "site");
const DIST = path.join(SITE, "dist");
rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

const unavailable = path.join(SITE, "stubs", "node-unavailable.js");
const result = await build({
  entryPoints: [path.join(SITE, "src", "main.ts")],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["chrome120", "firefox121", "safari17"],
  minify: true,
  sourcemap: false,
  outfile: path.join(DIST, "playground.js"),
  inject: [path.join(SITE, "stubs", "buffer-global.js")],
  alias: { "server-only": path.join(SITE, "stubs", "server-only.js"), "node:fs": unavailable, "node:path": unavailable },
  define: { "process.env.NODE_ENV": '"production"' },
  legalComments: "none",
  metafile: true,
  logLevel: "warning",
});
cpSync(path.join(SITE, "index.html"), path.join(DIST, "index.html"));
cpSync(path.join(SITE, "data", "screenshots"), path.join(DIST, "screenshots"), { recursive: true });
const bytes = Object.values(result.metafile.outputs).reduce((a, o) => a + o.bytes, 0);
console.log(`site/dist built: playground.js ${(bytes / 1024 / 1024).toFixed(2)} MB`);
