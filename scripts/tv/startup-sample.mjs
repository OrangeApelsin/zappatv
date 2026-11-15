#!/usr/bin/env node
/** Paired desktop setup DOM/heap samples, never a hardware acceptance claim. */
import { withBrowser } from "./browser.mjs";
import { findChrome, arg } from "./cdp.mjs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import os from "node:os";
async function sample(root) {
  return withBrowser(
    findChrome(),
    [
      "--headless",
      "--disable-gpu",
      "--disable-background-networking",
      "--no-first-run",
      "--window-size=1920,1080",
    ],
    "zappa-paired-boot-",
    async (cdp) => {
      await cdp.send("Runtime.enable");
      await cdp.send("Page.enable");
      await cdp.send("Network.enable");
      await cdp.send("Network.setBlockedURLs", { urls: ["http://*", "https://*"] });
      await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
        source: `(function(){var observer=new MutationObserver(function(){if(document.querySelector('#root > .app')&&document.querySelector('.onboard .setup-title')&&document.querySelector('.onboard button')){window.__setupDomAt=performance.now();observer.disconnect();}});observer.observe(document,{childList:true,subtree:true});})();`,
      });
      await cdp.send("Page.navigate", { url: pathToFileURL(resolve(root, "index.html")).href });
      const deadline = Date.now() + 10000;
      let at;
      do {
        await new Promise((done) => setTimeout(done, 50));
        const result = await cdp.send("Runtime.evaluate", {
          expression: "window.__setupDomAt||0",
          returnByValue: true,
        });
        at = result.result.value;
      } while (!at && Date.now() < deadline);
      if (!at) throw new Error("Setup DOM measurement unavailable");
      await cdp.send("Runtime.evaluate", {
        expression:
          "document.fonts.ready.then(function(){return new Promise(function(done){requestAnimationFrame(function(){requestAnimationFrame(done);});});})",
        awaitPromise: true,
      });
      await cdp.send("HeapProfiler.collectGarbage");
      const heap = await cdp.send("Runtime.getHeapUsage");
      return {
        setupDomMs: at,
        jsHeapBytes: heap.usedSize,
        browser: (await cdp.send("Browser.getVersion")).product,
      };
    },
  );
}

if (!findChrome())
  throw new Error("Chrome or CHROME_PATH required; missing browser is not a pass.");
const before = arg("before");
const after = arg("after");
if (!before || !after)
  throw new Error(
    "Provide --before=EXTRACTED_BASELINE --after=EXTRACTED_CANDIDATE; fresh setup UI is required.",
  );
const records = [];
for (let round = 0; round < 4; round++)
  for (const side of ["before", "after"])
    records.push({
      round,
      warmup: round === 0,
      side,
      ...(await sample(side === "before" ? before : after)),
    });
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const summary = {};
for (const side of ["before", "after"]) {
  const runs = records.filter((record) => record.side === side && !record.warmup);
  const times = runs.map((record) => record.setupDomMs);
  const center = median(times);
  summary[side] = {
    setupDomMedianMs: center,
    jsHeapMedianBytes: median(runs.map((record) => record.jsHeapBytes)),
    spread: (Math.max(...times) - Math.min(...times)) / center,
  };
}
console.log(
  JSON.stringify(
    {
      method:
        "One discarded warmup then three interleaved pairs; fresh headless profiles; file origin; HTTP(S) blocked. Setup DOM marker, not paint/remote latency. Fonts settled plus two frames and explicit GC before JS heap sample. Desktop only, not calibrated to TV.",
      environment: {
        os: os.release(),
        arch: os.arch(),
        cpu: os.cpus()[0].model,
        node: process.versions.node,
      },
      records,
      summary,
    },
    null,
    2,
  ),
);
if (Object.values(summary).some((result) => result.spread > 0.2))
  throw new Error("Timing spread exceeds 20%; no stable comparison, repeat on a quiet host.");
