#!/usr/bin/env node
/** Mount-only desktop baseline probe, not a Tizen compatibility/performance gate.
 * Run on an unpacked widget: node scripts/tv/boot-probe.mjs --entry=PATH/index.html
 * Fresh headless profiles, no user data or HTTP(S); JSON stdout, exit 2 on failure.
 */
import { arch, cpus, platform, release } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { withBrowser } from "./browser.mjs";
import { arg, findChrome } from "./cdp.mjs";
import { LAUNCH_DEADLINE_MS, LAUNCH_MARKS } from "./launch-marks.mjs";

const entry = arg("entry");
const binary = findChrome();
if (!entry || !binary)
  throw new Error("Provide --entry=PATH/index.html and Chrome/CHROME_PATH.");
const records = [];
for (let round = 1; round <= 3; round++) {
  records.push(
    await withBrowser(
      binary,
      [
        "--headless=new",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        "--window-size=1920,1080",
      ],
      "zappa-boot-probe-",
      async (cdp) => {
        const exceptions = [];
        cdp.on("Runtime.exceptionThrown", (event) =>
          exceptions.push(
            event.exceptionDetails?.exception?.description ?? event.exceptionDetails?.text,
          ),
        );
        for (const domain of ["Runtime", "Page", "Network"]) await cdp.send(`${domain}.enable`);
        await cdp.send("Network.setBlockedURLs", { urls: ["http://*", "https://*"] });
        const browser = await cdp.send("Browser.getVersion");
        await cdp.send("Page.navigate", { url: pathToFileURL(resolve(entry)).href });
        const deadline = Date.now() + LAUNCH_DEADLINE_MS;
        let sample;
        do {
          await new Promise((done) => setTimeout(done, 100));
          const reply = await cdp.send("Runtime.evaluate", {
            expression: `JSON.stringify({mounted:${LAUNCH_MARKS["the interface"]},onboarding:!!document.querySelector('.onboard'),sampledAt:performance.now()})`,
            returnByValue: true,
          });
          sample = JSON.parse(reply.result.value);
        } while (!sample.mounted && !exceptions.length && Date.now() < deadline);
        return { round, browser: browser.product, ...sample, exceptions };
      },
    ),
  );
}
console.log(
  JSON.stringify(
    {
      entry: resolve(entry),
      environment: {
        platform: platform(),
        release: release(),
        arch: arch(),
        cpu: cpus()[0].model,
        node: process.versions.node,
      },
      method:
        "Fresh desktop profiles; file origin; HTTP(S) blocked; 100ms polling. Not TV, interactive readiness, calibrated timing or memory evidence.",
      records,
    },
    null,
    2,
  ),
);
if (records.some((record) => !record.mounted || record.exceptions.length)) process.exitCode = 2;
