#!/usr/bin/env node
import { packageVersion } from "./widget-metadata.mjs";
/**
 * Build and package Zappa 2 for all supported Samsung Tizen generations:
 * - Tizen 3.0 (Chromium 47, 2017) -> build/zappa-${version}-tizen3.wgt
 * - Tizen 4.0 (Chromium 56, 2018) -> build/zappa-${version}-tizen4.wgt
 * - Tizen 5.0 (Chromium 63, 2019) -> build/zappa-${version}-tizen5.wgt
 * - Tizen 5.5+ (Chromium 69+, 2020+) -> build/zappa-${version}.wgt
 *
 * Only versioned .wgt and .sha256 files are produced.
 */
import { execSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { packageWidget } from "./package-wgt.mjs";
import { packageTargets, widgetName } from "./tv/platforms.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const version = packageVersion();

const TARGETS = packageTargets.map((tv) => ({
  target: tv.tizen,
  name: widgetName(version, tv.tizen),
}));

// Release receipts select eligible targets before the asset set is frozen. A
// failing/omitted experimental target must not force a stable release asset in.
const requested = process.env.TIZEN_TARGETS?.split(",").map((target) => target.trim());
if (
  requested &&
  (new Set(requested).size !== requested.length ||
    requested.some((target) => !TARGETS.some((config) => config.target === target)))
) {
  throw new Error("TIZEN_TARGETS contains an unknown, empty or duplicate target.");
}
const selectedTargets = requested
  ? TARGETS.filter((config) => requested.includes(config.target))
  : TARGETS;

console.log(
  `\nBuilding and packaging Zappa 2 v${version} for ${selectedTargets.length} Tizen targets...\n`,
);

const results = [];

for (const t of selectedTargets) {
  console.log(`------------------------------------------------------------`);
  console.log(`Building target Tizen ${t.target} (${t.name})...`);
  console.log(`------------------------------------------------------------`);

  // Execute build with specific TIZEN_TARGET
  execSync("npm run build", {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, TIZEN_TARGET: t.target },
  });

  const res = packageWidget({
    target: t.target,
    outName: t.name,
  });

  results.push(res);
}

console.log("\n============================================================");
console.log(`Successfully built ${results.length} versioned Tizen packages:`);
for (const r of results) {
  const kb = (r.bytes / 1024).toFixed(1);
  console.log(
    `  build/${r.name.padEnd(28)} (${kb.padStart(7)} KB)  SHA-256: ${r.sha256.slice(0, 16)}...`,
  );
}
console.log("============================================================\n");
