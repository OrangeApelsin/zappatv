#!/usr/bin/env node
/** Verify final packaged startup across pinned capability families, without substitution.
 * M63: no native fetch abort/cache getter/ResizeObserver. M69: native abort/resize,
 * no flex gap. M130: modern flex gap. Worker failure/minimal API/clean setup/recovery
 * paths run in each. --all adds every declared 5.5+ engine; this is desktop simulation,
 * not proof of every Samsung firmware, AVPlay or calibrated speed.
 * Epic 20 adds both VOD layouts, async states, XL text, EN/SV/AR and gap parity.
 * Full resource/performance calibration remains TICKET-2201.
 */
import { execFileSync } from "node:child_process";
import { packageTargets, supported } from "./platforms.mjs";
const all = process.argv.includes("--all");
let failed = false;
for (const tv of packageTargets.filter((tv) => !tv.package.experimental)) {
  const engines =
    tv.tizen === "5.0"
      ? ["5.0"]
      : all
        ? supported.filter((p) => Number(p.tizen) >= 5.5).map((p) => p.tizen)
        : ["5.5", "10.0"];
  for (const engine of engines) {
    try {
      execFileSync(
        process.execPath,
        [
          "scripts/tv/candidate-gate.mjs",
          `--target=${tv.tizen}`,
          "--mode=engine",
          `--engine=${engine}`,
        ],
        { stdio: "inherit" },
      );
    } catch {
      failed = true;
    }
  }
}
if (failed) process.exitCode = 1;
