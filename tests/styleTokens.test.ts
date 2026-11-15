import { readFileSync, readdirSync } from "node:fs";
import { expect, test } from "vitest";

test("all CSS variables resolve to stylesheet definitions or documented runtime values", () => {
  const css =
    readdirSync("src/styles")
      .filter((name) => name.endsWith(".css"))
      .map((name) => readFileSync(`src/styles/${name}`, "utf8"))
      .join("\n") + readFileSync("public/fonts/fonts.css", "utf8");
  const defined = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1]));
  // metrics.applyMetrics, ChannelList's number width, and Text's measured motion.
  const runtime = new Set([
    "--row-base",
    "--logo-w",
    "--logo-h",
    "--ch-digits",
    "--teleprompter-shift",
  ]);
  const used = new Set([...css.matchAll(/var\((--[\w-]+)/g)].map((match) => match[1]));
  expect([...used].filter((name) => !defined.has(name) && !runtime.has(name))).toEqual([]);
});
