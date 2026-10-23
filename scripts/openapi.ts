/** npm run openapi [-- --check]: write docs/openapi.json, or fail if it is out of date. */
import { readFileSync, writeFileSync } from "node:fs";
import { buildOpenApi } from "./lib/openapi-spec";

const FILE = "docs/openapi.json";
const text = JSON.stringify(buildOpenApi(), null, 2) + "\n";
if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(FILE, "utf8");
  } catch {}
  if (current !== text) {
    console.error(`${FILE} is out of date: run npm run openapi`);
    process.exit(1);
  }
  console.log(`${FILE} is up to date.`);
} else {
  writeFileSync(FILE, text);
  console.log(`wrote ${FILE}`);
}
