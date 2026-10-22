import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const file = path.join(process.cwd(), ".test-data", "env.json");
if (existsSync(file)) {
  Object.assign(process.env, JSON.parse(readFileSync(file, "utf8")) as Record<string, string>);
}
