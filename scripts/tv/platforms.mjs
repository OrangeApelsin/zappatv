/**
 * Samsung's engine matrix, read from the one file that holds it.
 *
 * The same table used to be written out in prose in three places and two of them were a
 * generation wrong, saying the 2020 sets run Chromium 76 when they run 69. That is the row
 * height problem again: a fact restated is a fact that drifts, and nothing fails when it
 * does. So platforms.json owns it and everything else asks.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const table = JSON.parse(readFileSync(join(here, "platforms.json"), "utf8"));

/** Every platform this application supports, oldest engine first. */
export const supported = table.platforms.filter(
  (p) => Number.parseFloat(p.tizen) >= Number.parseFloat(table.supportedFrom),
);

export const packageTargets = table.platforms.filter((p) => p.package);
export const targetPolicy = (target = "5.5") => {
  const found = packageTargets.find((p) => p.tizen === target);
  if (!found) throw new Error(`Unknown Tizen package target: ${target}`);
  return found;
};
export const widgetName = (version, target) =>
  `zappa-${version}${targetPolicy(target).package.suffix}.wgt`;

/** The oldest engine in the supported range, which is the one everything is built for. */
export const floorPlatform = () => supported.find((p) => p.floor) ?? supported[0];

/** Modern representative; additional capability families require explicit coverage. */
export const ceilingPlatform = () =>
  supported.find((p) => p.ceiling) ?? supported[supported.length - 1];

export const platformOf = (tizen) => table.platforms.find((p) => p.tizen === String(tizen));

export const source = table.source;
export const checked = table.checked;
