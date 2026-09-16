import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "apps/web/dist");
const dest = path.join(root, "apps/bridge/public");

if (!existsSync(path.join(src, "index.html"))) {
  console.error("Missing apps/web/dist/index.html — Vite build failed.");
  process.exit(1);
}

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log(`Copied web dist → ${dest}`);
