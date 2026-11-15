#!/usr/bin/env node
// Font-only desktop fixture: separate asset bytes, CSS-ready/paint and metric drift.
// This is not app boot timing, calibrated TV evidence or proof of fallback glyphs.
import { createServer } from "node:http";
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { withBrowser } from "./browser.mjs";
import { arg, findChrome } from "./cdp.mjs";

const samples = {
  en: "Movies and Series 0123456789",
  sv: "ÅÄÖ åäö filmer och serier",
  ar: "الأفلام والمسلسلات العربية ١٢٣",
};
const binary = arg("binary") ?? findChrome();
if (!binary || !arg("before") || !arg("after"))
  throw new Error("Provide --before=ROOT --after=ROOT and a browser.");
const fontDelayMs = Number(arg("font-delay-ms") ?? 100);
if (!Number.isFinite(fontDelayMs) || fontDelayMs < 0 || fontDelayMs > 1000)
  throw new Error("Use a font delay from 0 to 1000ms.");
const reports = [];
for (const side of ["before", "after"]) {
  const root = resolve(arg(side), "fonts");
  const cssBytes = statSync(join(root, "fonts.css")).size;
  const installedBytes = readdirSync(root).reduce(
    (sum, name) => sum + statSync(join(root, name)).size,
    0,
  );
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const file = /^\/fonts\/([A-Za-z0-9.-]+)$/.exec(url.pathname)?.[1];
    if (file) {
      try {
        const payload = readFileSync(join(root, file));
        res.writeHead(200, {
          "Content-Type": file.endsWith("css")
            ? "text/css; charset=utf-8"
            : file.endsWith("ttf")
              ? "font/ttf"
              : "font/woff2",
          "Cache-Control": "public, max-age=3600",
        });
        if (file.endsWith("css")) res.end(payload);
        else setTimeout(() => res.end(payload), fontDelayMs);
      } catch {
        res.writeHead(404);
        res.end();
      }
      return;
    }
    const locale = url.searchParams.get("locale");
    if (!Object.hasOwn(samples, locale)) {
      res.writeHead(400);
      res.end();
      return;
    }
    const run = url.searchParams.get("run") === "warm" ? "warm" : "cold";
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(`<!doctype html><html lang="${locale}" dir="${locale === "ar" ? "rtl" : "ltr"}"><meta charset="utf-8">
      <script>window.cssReadyMs=0;</script><link rel="stylesheet" href="/fonts/fonts.css" onload="window.cssReadyMs=performance.now()">
      <style>body{font-family:var(--font);font-size:28px;background:#111;color:white}.sample{width:600px;height:40px;line-height:40px;overflow:hidden}.bold{font-weight:600}</style>
      <body data-run="${run}"><div class="sample"><span>${samples[locale]}</span></div><div class="sample bold"><span>${samples[locale]}</span></div>
      <script>requestAnimationFrame(function(){var nodes=document.querySelectorAll('.sample span');var before=Array.prototype.map.call(nodes,function(e){return e.getBoundingClientRect().width;});document.fonts.ready.then(function(){requestAnimationFrame(function(){var after=Array.prototype.map.call(nodes,function(e){return e.getBoundingClientRect().width;});var css=performance.getEntriesByType('resource').filter(function(e){return /fonts.css/.test(e.name);})[0];window.fontReport={cssReadyMs:window.cssReadyMs,cssDownloadMs:css&&css.duration,cssAfterResponseMs:css&&window.cssReadyMs-css.responseEnd,fontReadyMs:performance.now(),widthDrift:after.map(function(w,i){return w-before[i];}),rowHeights:Array.prototype.map.call(document.querySelectorAll('.sample'),function(e){return e.getBoundingClientRect().height;})};});});});</script>`);
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  try {
    for (const locale of Object.keys(samples)) {
      const records = await withBrowser(
        binary,
        ["--headless", "--no-sandbox", "--disable-gpu", "--no-first-run"],
        "zappa-font-probe-",
        async (cdp) => {
          await cdp.send("Page.enable");
          await cdp.send("Network.enable");
          await cdp.send("Network.clearBrowserCache");
          const rows = [];
          for (const run of ["cold", "warm"]) {
            await cdp.send("Page.navigate", {
              url: `http://127.0.0.1:${server.address().port}/?locale=${locale}&run=${run}`,
            });
            const deadline = Date.now() + 15000;
            let record;
            while (Date.now() < deadline) {
              const result = await cdp.send("Runtime.evaluate", {
                expression: `document.body&&document.body.getAttribute('data-run')==='${run}'&&window.fontReport&&JSON.stringify(Object.assign({},window.fontReport,{firstTextPaintMs:(performance.getEntriesByType('paint').filter(function(e){return e.name==='first-contentful-paint';})[0]||{}).startTime}))`,
                returnByValue: true,
              });
              if (typeof result.result.value === "string") {
                record = JSON.parse(result.result.value);
                if (Number.isFinite(record.firstTextPaintMs)) break;
                record = undefined;
              }
              await new Promise((done) => setTimeout(done, 50));
            }
            if (!record || record.rowHeights.some((height) => height !== 40))
              throw new Error("Font fixture did not finish with fixed row geometry.");
            rows.push({ side, locale, run, cssBytes, installedBytes, ...record });
          }
          return rows;
        },
      );
      reports.push(...records);
    }
  } finally {
    await new Promise((done) => server.close(done));
  }
}
const output = resolve(arg("out") ?? "build/audit/2103-font-probe.json");
mkdirSync(dirname(output), { recursive: true });
writeFileSync(
  output,
  `${JSON.stringify(
    {
      fontDelayMs,
      simulation: true,
      hardwareTested: false,
      method:
        "font-only loopback fixture with controlled font transfer delay; CSS after-response includes parse/event scheduling; first contentful paint is text; width drift is not CLS",
      reports,
    },
    null,
    2,
  )}\n`,
);
console.log(`Recorded ${reports.length} cold/warm font fixture samples: ${output}`);
