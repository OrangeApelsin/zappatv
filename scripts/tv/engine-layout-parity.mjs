#!/usr/bin/env node
/** Preserved structural geometry diagnostic. Build TIZEN_TARGET=5.0 first.
 * Exact pinned engines only; never a substituted pass. TICKET-2201 extends the
 * shared walk to the remaining VOD views and makes geometry coverage required.
 * This diagnostic does not replace per-WGT startup/engine qualification. */
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { withBrowser } from "./browser.mjs";
import { ensureEngine } from "./engines.mjs";
import { supported, floorPlatform, ceilingPlatform, source } from "./platforms.mjs";
import { serve, walk, compare } from "./harness.mjs";

const ROOT = resolve(import.meta.dirname, "../..");
const DIST = join(ROOT, "dist");

const LAYOUT = [
  ".app",
  ".panel",
  ".panel-cols",
  ".rail",
  ".list",
  ".pane-head",
  ".viewport",
  ".window",
  ".row",
  ".sheet",
  ".sheet-rail",
  ".sheet-body",
  ".dialog",
  ".splash",
  ".hints",
  ".actions",
  ".field",
  ".pl",
  ".pad",
  ".panel-hints",
];

const TOLERANCE = 4;

const VARIES_BY_ENGINE = new Set(["settings.diagnostics"]);

async function attempt(tv, binary, port, providerOrigin) {
  return withBrowser(
    binary,
    [
      "--headless",
      "--window-size=1920,1080",
      "--force-device-scale-factor=1",
      "--lang=en-US",
      "--no-first-run",
      "--no-default-browser-check",
      "--autoplay-policy=no-user-gesture-required",
      "--hide-scrollbars",

      "--no-sandbox",

      "--disable-gpu",
      "about:blank",
    ],
    `openiptv-engine-${tv.tizen}-`,
    async (cdp) => {
      const complaints = [];
      await cdp.send("Runtime.enable");
      await cdp.send("Page.enable");
      await cdp.send("Log.enable").catch(() => {});

      const { product } = await cdp.send("Browser.getVersion");
      const major = Number(/Chrom(?:e|ium)\/(\d+)/.exec(product ?? "")?.[1]);
      if (major !== tv.chromium) {
        throw new Error(
          `Expected Chromium ${tv.chromium} for Tizen ${tv.tizen} and got ${product}. ` +
            "The lock, the snapshot hint or the cached download disagree with platforms.json.",
        );
      }

      await cdp.send("Emulation.setUserAgentOverride", { userAgent: tv.userAgent });

      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: 1920,
        height: 1080,
        deviceScaleFactor: 1,
        mobile: false,
      });

      cdp.on("Runtime.exceptionThrown", ({ exceptionDetails }) => {
        complaints.push(
          `threw: ${
            exceptionDetails.exception?.description ?? exceptionDetails.text ?? "unknown"
          }`,
        );
      });
      cdp.on("Runtime.consoleAPICalled", ({ type, args }) => {
        if (type !== "error") return;
        complaints.push(
          `console.error: ${args.map((a) => a.value ?? a.description ?? "").join(" ")}`,
        );
      });
      cdp.on("Log.entryAdded", ({ entry }) => {
        if (entry.level === "error" && !entry.text.includes("example.invalid")) {
          complaints.push(`${entry.source}: ${entry.text}`);
        }
      });

      const shots = await walk(cdp, port, LAYOUT, { providerOrigin });

      const rows = await cdp
        .send("Runtime.evaluate", {
          expression: "document.querySelectorAll('.list .row').length",
          returnByValue: true,
        })
        .then((r) => r.result.value);
      return { shots, complaints, rows };
    },
  );
}

async function inEngine(tv, port, providerOrigin) {
  const pinned = await ensureEngine(tv);
  return { ...(await attempt(tv, pinned, port, providerOrigin)), pinned: true };
}

async function main() {
  if (!existsSync(join(DIST, "index.html"))) {
    console.error("No build to measure. Run `npm run build` first.");
    process.exit(2);
  }

  const wanted = process.argv.includes("--all")
    ? supported
    : [floorPlatform(), ceilingPlatform()];
  const [reference] = wanted;

  console.log("Engine parity");
  console.log(`  against  ${source}`);
  console.log(
    `  engines  ${wanted.map((p) => `Tizen ${p.tizen} / M${p.chromium}`).join(", ")}`,
  );
  console.log(
    `  baseline Tizen ${reference.tizen}, Chromium ${reference.chromium}, ` +
      "the oldest engine a supported set runs\n",
  );

  const hosted = await serve(DIST);
  const provider = await serve(DIST);
  const providerOrigin = `http://127.0.0.1:${provider.port}`;
  let failures = 0;
  try {
    const runs = [];
    for (const tv of wanted) {
      process.stdout.write(`  Tizen ${tv.tizen} (M${tv.chromium})  `);
      const result = await inEngine(tv, hosted.port, providerOrigin);
      console.log(
        `${result.rows} rows drawn, ${result.complaints.length} complaints` +
          `${result.pinned ? "" : ", NOT the pinned engine"}`,
      );
      runs.push({ tv, ...result });
    }

    for (const run of runs) {
      if (!run.rows) {
        console.error(
          `\nTizen ${run.tv.tizen} drew no channel rows at all. ` +
            "The app did not reach a usable state on that engine.",
        );
        failures += 1;
      }
      for (const complaint of run.complaints) {
        console.error(`\nTizen ${run.tv.tizen} (Chromium ${run.tv.chromium})  ${complaint}`);
        failures += 1;
      }
    }

    for (const run of runs.slice(1)) {
      console.log(`\n  Tizen ${reference.tizen} against Tizen ${run.tv.tizen}`);
      const { boxes, differing, screens } = compare(runs[0].shots, run.shots, {
        tolerance: TOLERANCE,
        labels: [`M${reference.chromium}`, `M${run.tv.chromium}`],
        skip: VARIES_BY_ENGINE,
      });
      console.log(
        `  ${boxes} boxes across ${screens} screens, ${differing} differing` +
          `${VARIES_BY_ENGINE.size ? `, ${[...VARIES_BY_ENGINE].join(", ")} not compared` : ""}`,
      );
      failures += differing;
    }

    if (failures) {
      console.error("\nThe app does not behave the same across the engines Samsung ships.");
      console.error("A layout difference means a CSS feature the older engine lacks; the");
      console.error("engine that gained what is missing is listed in platforms.json.");
    } else {
      console.log("\nSame behaviour, same layout, no complaints.");
    }
  } finally {
    await Promise.all([hosted.close(), provider.close()]);
  }
  process.exit(failures ? 1 : 0);
}

main();
