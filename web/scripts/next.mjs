// Runs the Next.js CLI with the repository root .env loaded, so one file configures
// both the contracts and the web app. Usage: node scripts/next.mjs <dev|build|start> [...args]
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const envFile = fileURLToPath(new URL("../../.env", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

await import("next/dist/bin/next");
