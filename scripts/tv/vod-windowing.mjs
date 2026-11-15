#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
/** Extracted-widget large-catalog probe. Desktop observations, never AVPlay/TV
 * acceptance. Deterministic DOM/decode bounds are enforced; host timing is
 * recorded against the 1801 target with calibration/TV samples still separate. */
import { createServer } from "node:http";
import { cpus } from "node:os";
import { join, resolve } from "node:path";
import { checkWidget } from "../check-widget.mjs";
import { installAvplayFixture } from "./avplay-fixture.mjs";
import { withBrowser } from "./browser.mjs";
import { catalogFixture } from "./catalog-fixture.mjs";
import { arg, findChrome } from "./cdp.mjs";
import { ensureEngine } from "./engines.mjs";
import { serve } from "./harness.mjs";
import { platformOf } from "./platforms.mjs";
import { openFixtureMovies } from "./startup-journey.mjs";
import { runVodLayouts } from "./vod-layout-journey.mjs";

const locale = arg("locale") ?? "en";
if (!["en", "sv", "ar"].includes(locale)) throw new Error("Unknown locale");
const count = Number(arg("count") ?? 20000);
const kind = arg("kind") ?? "movie";
if (!["movie", "series"].includes(kind)) throw new Error("Unknown catalogue kind");
const sampleCount = Number(arg("samples") ?? 100);
if (![10, 100].includes(sampleCount))
  throw new Error("Use 10 functional samples or 100 measurement samples");
const fixture = catalogFixture({ count });
if (arg("ui") === "true")
  for (let i = fixture.categories.length; i < 105; i++)
    fixture.categories.push({ category_id: `empty-${i}`, category_name: `Category ${i}` });
const evidence = resolve("build/candidate-evidence");
mkdirSync(evidence, { recursive: true });
const temporary = mkdtempSync(join(evidence, "vod-window-"));
const root = join(temporary, "widget");
const wgt = resolve(arg("wgt") ?? "build/zappa-2.4.0-tizen5.wgt");
const bytes = readFileSync(wgt);
execFileSync(process.platform === "win32" ? "python" : "python3", [
  "scripts/extract-widget.py",
  wgt,
  root,
]);
const target = arg("target") ?? "5.0";
checkWidget({
  root,
  target,
  version: JSON.parse(readFileSync("package.json", "utf8")).version,
});
const engine = arg("engine") ? platformOf(arg("engine")) : null;
const binary = arg("binary") ?? (engine ? await ensureEngine(engine) : findChrome());
if (!binary) throw new Error("Browser is required");
const app = await serve(root);
const mode = {
  failDetail: false,
  holdCatalog: arg("ui") === "true",
  waiting: [],
  requests: { get_vod_streams: 0, get_series: 0 },
};
const backend = createServer((req, res) => {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader(
    "access-control-allow-headers",
    "Cache-Control, Pragma, Content-Type, x-zappa-token",
  );
  res.setHeader("access-control-allow-methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }
  if (req.url.startsWith("/poster.svg")) {
    res.setHeader("content-type", "image/svg+xml");
    return res.end(
      '<svg xmlns="http://www.w3.org/2000/svg" width="208" height="312"><rect width="208" height="312" fill="#345"/></svg>',
    );
  }
  const action = new URL(req.url, "http://fixture").searchParams.get("action");
  if (action === "get_vod_info" && mode.failDetail) {
    res.statusCode = 503;
    return res.end("Offline fixture");
  }
  const body = {
    get_vod_info: {
      info: {
        name: `Long movie ÅÄÖ العربية ${"Very long title ".repeat(12)}`,
        plot: "Fixture detail",
        movie_image: "",
      },
      movie_data: {
        stream_id: count,
        name: "Fixture movie",
        category_id: "4",
        container_extension: "mkv",
      },
    },
    get_live_categories: [{ category_id: "live", category_name: "Live" }],
    get_live_streams: [{ stream_id: 1, category_id: "live", name: "Fixture Live" }],
    get_vod_categories: fixture.categories,
    get_series_categories: fixture.categories,
    get_vod_streams: fixture.movies,
    get_series: fixture.series,
    get_series_info: fixture.seriesInfo,
  }[action] ?? { user_info: { auth: 1, status: "Active" } };
  res.setHeader("content-type", "application/json");
  if (["get_vod_streams", "get_series"].includes(action)) {
    mode.requests[action]++;
    const send = () => {
      if (!res.destroyed) res.end(JSON.stringify(body));
    };
    if (mode.holdCatalog) mode.waiting.push(send);
    else setTimeout(send, 650);
  } else res.end(JSON.stringify(body));
});
await new Promise((resolve) => backend.listen(0, "127.0.0.1", resolve));
const provider = `http://127.0.0.1:${backend.address().port}`;
for (const item of fixture.movies) {
  item.stream_icon = `${provider}/poster.svg?item=${item.stream_id}`;
  if (item.stream_id === count) item.name = "Z FINAL";
}
for (const item of fixture.series) {
  item.cover = `${provider}/poster.svg?item=${item.series_id}`;
  if (item.series_id === count) item.name = "Z FINAL";
}
const report = {
  kind,
  source: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  sourceDirty: !!execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim(),
  sha256: createHash("sha256").update(bytes).digest("hex"),
  count,
  target,
  locale,
  simulation: true,
  hardwareTested: false,
  host: { cpu: cpus()[0].model, node: process.version },
  status: "failed",
};
const reportPath = join(
  evidence,
  `vod-windowing-${target}-${arg("engine") ?? "desktop"}-${count}-${locale}.json`,
);
const checkpoint = (stage) => {
  report.checkpoint = stage;
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
};
try {
  await withBrowser(
    binary,
    [
      "--headless",
      "--no-sandbox",
      "--disable-gpu",
      "--window-size=1920,1080",
      "--force-device-scale-factor=1",
    ],
    "zappa-vod-window-",
    async (cdp) => {
      await cdp.send("Page.enable");
      await cdp.send("Runtime.enable");
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: 1920,
        height: 1080,
        deviceScaleFactor: 1,
        mobile: false,
      });
      const version = await cdp.send("Browser.getVersion");
      report.browser = version.product;
      if (engine && !version.product.includes(`/${engine.chromium}.`))
        throw new Error("Wrong engine binary");
      const errors = [];
      cdp.on("Runtime.exceptionThrown", (event) =>
        errors.push(
          event.exceptionDetails?.exception?.description ?? event.exceptionDetails?.text,
        ),
      );
      await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
        source: `(function(){
      if(location.protocol==='about:')return;
      localStorage.setItem('openiptv.settings',JSON.stringify({playlists:[{id:'window-fixture',name:'Fixture',source:{kind:'xtream',server:${JSON.stringify(provider)},username:'fixture',password:'fixture',output:'ts'},sourceVersion:1}],activePlaylistId:'window-fixture',resumeLast:false,startScreen:'home',locale:${JSON.stringify(locale)},fontSizeId:'xl',showClock:false}));
      localStorage.setItem('zappa.viewMode','grid');
      window.__catalogTimings={};
      window.addEventListener('zappa-catalog-timing',function(event){var d=event.detail;window.__catalogTimings[d.kind+':'+d.mode]=d;});
      window.__posterProbe={active:0,peak:0};
      var descriptor=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src');
      Object.defineProperty(HTMLImageElement.prototype,'src',{get:descriptor.get,set:function(value){
        if(String(value).indexOf('/poster.svg')>=0&&!this.__counted){this.__counted=true;window.__posterProbe.active++;window.__posterProbe.peak=Math.max(window.__posterProbe.peak,window.__posterProbe.active);}
        if(!value&&this.__counted){this.__counted=false;window.__posterProbe.active--;}
        descriptor.set.call(this,value);
      }});
    })();`,
      });
      if (arg("native") === "true")
        await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
          source: `(${installAvplayFixture.toString()})()`,
        });
      await cdp.send("Page.navigate", { url: `http://127.0.0.1:${app.port}/` });
      const ev = async (expression) => {
        const result = await cdp.send(
          "Runtime.evaluate",
          {
            expression,
            returnByValue: true,
            awaitPromise: true,
          },
          15000,
        );
        if (result.exceptionDetails)
          throw new Error(
            result.exceptionDetails.exception?.description ?? result.exceptionDetails.text,
          );
        return result.result.value;
      };
      const capture = async (name) => {
        const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
        writeFileSync(
          join(evidence, `vod-${target}-${arg("engine") ?? "desktop"}-${locale}-${name}.png`),
          Buffer.from(shot.data, "base64"),
        );
      };
      if (arg("ui") === "true") {
        const until = Date.now() + 30000;
        while (
          Date.now() < until &&
          !(await ev("!!document.querySelector('.home-tile-channel')"))
        )
          await new Promise((resolve) => setTimeout(resolve, 100));
        await runVodLayouts({ ev, capture, report, checkpoint, phase: "home" });
      }
      let selected = false;
      let loadingCaptured = false;
      const deadline = Date.now() + 60000;
      while (Date.now() < deadline) {
        if (!selected)
          selected = await ev(`(${openFixtureMovies.toString()})(${JSON.stringify(kind)})`);
        if (
          arg("ui") === "true" &&
          selected &&
          !loadingCaptured &&
          (await ev("!!document.querySelector('.vod-load-stage')"))
        ) {
          await runVodLayouts({ ev, capture, report, checkpoint, phase: "loading", mode });
          loadingCaptured = true;
        }
        if (
          selected &&
          (await ev(
            `!!document.querySelector('.vod-grid[data-total="${count}"]')&&!document.querySelector('.vod-load')`,
          ))
        )
          break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (
        !selected ||
        !(await ev(
          `!!document.querySelector('.vod-tile')&&!document.querySelector('.vod-load')`,
        ))
      ) {
        report.load = { selected, text: await ev("document.body.innerText.slice(-1000)") };
        throw new Error("Catalog did not finish");
      }
      const before = await ev(
        `({tiles:document.querySelectorAll('.vod-tile').length,canvases:document.querySelectorAll('#view-vod canvas').length})`,
      );
      if (before.tiles > 30 || before.canvases > 31) throw new Error("Unbounded poster DOM");
      const samples = [];
      for (let i = 0; i < sampleCount; i++) {
        const sample = await ev(
          `new Promise(function(done){var start=performance.now();var e=new KeyboardEvent('keydown',{bubbles:true,cancelable:true});Object.defineProperty(e,'keyCode',{value:40});window.dispatchEvent(e);requestAnimationFrame(function(){requestAnimationFrame(function(){done(performance.now()-start);});});})`,
        );
        samples.push(sample);
        await new Promise((resolve) => setTimeout(resolve, Math.max(0, 200 - sample)));
      }
      await ev(
        `Array.prototype.find.call(document.querySelectorAll('.vod-az b'),function(el){return el.textContent==='Z';}).click()`,
      );
      await new Promise((resolve) => setTimeout(resolve, 300));
      const last = await ev(
        `(function(){var el=document.querySelector('.vod-tile.focused');var box=el&&el.getBoundingClientRect();return {key:el&&el.getAttribute('data-media-key'),top:box&&box.top,bottom:box&&box.bottom,tiles:document.querySelectorAll('.vod-tile').length,posters:window.__posterProbe};})()`,
      );
      if (
        !last.key?.endsWith(`:${kind}:${count}`) ||
        last.tiles > 30 ||
        last.top < 230 ||
        last.bottom > 1081 ||
        last.posters.peak > 2
      )
        throw new Error(`Final row or decode bound failed: ${JSON.stringify(last)}`);
      const ordered = samples.toSorted((a, b) => a - b);
      Object.assign(report, {
        before,
        last,
        keyToTwoFramesMs: {
          samples: samples.length,
          p50: ordered[Math.ceil(sampleCount * 0.5) - 1],
          p95: ordered[Math.ceil(sampleCount * 0.95) - 1],
          targetP95: 100,
        },
        errors,
        catalogTimings: await ev("window.__catalogTimings"),
      });
      if (errors.length || ordered[Math.ceil(sampleCount * 0.95) - 1] > 100)
        throw new Error("Runtime error or navigation target missed");
      if (arg("loads") === "true") {
        const waitLoaded = async () => {
          const deadline = Date.now() + 60000;
          while (Date.now() < deadline) {
            if (
              await ev(
                "!!document.querySelector('.vod-tile')&&!document.querySelector('.vod-load')",
              )
            ) {
              await new Promise((resolve) => setTimeout(resolve, 100));
              return;
            }
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
          throw new Error("Repeated catalogue load did not finish");
        };
        const cold = await ev("window.__catalogTimings");
        await ev("document.querySelectorAll('.vod-tab')[2].click()");
        await ev("document.querySelector('[data-header-control=layout]').click()");
        await waitLoaded();
        const memoryWarm = await ev("window.__catalogTimings");
        await cdp.send("Page.reload");
        const homeDeadline = Date.now() + 30000;
        while (
          Date.now() < homeDeadline &&
          !(await ev(`(${openFixtureMovies.toString()})(${JSON.stringify(kind)})`))
        )
          await new Promise((resolve) => setTimeout(resolve, 100));
        await waitLoaded();
        report.loads = { cold, memoryWarm, restart: await ev("window.__catalogTimings") };
      }
      if (arg("ui") === "true") {
        if (!loadingCaptured) throw new Error("Loading state was not observed");
        await runVodLayouts({
          ev,
          capture,
          report,
          phase: "catalog",
          checkpoint,
          mode,
          cdp,
          appUrl: `http://127.0.0.1:${app.port}/`,
        });
      }
      if (arg("episodes") === "true") {
        await ev("document.querySelectorAll('.vod-tab')[1].click()");
        const seriesDeadline = Date.now() + 60000;
        while (
          Date.now() < seriesDeadline &&
          !(await ev(
            "!!document.querySelector('.vod-tile[data-media-key*=\":series:\"]')&&!document.querySelector('.vod-load')",
          ))
        )
          await new Promise((resolve) => setTimeout(resolve, 100));
        await ev("document.querySelector('.vod-tile').click()");
        const episodeDeadline = Date.now() + 30000;
        while (
          Date.now() < episodeDeadline &&
          !(await ev("!!document.querySelector('.sr-ep')"))
        )
          await new Promise((resolve) => setTimeout(resolve, 100));
        await ev(
          "(function(){for(var i=0;i<999;i++){var e=new KeyboardEvent('keydown',{bubbles:true,cancelable:true});Object.defineProperty(e,'keyCode',{value:40});window.dispatchEvent(e);}})()",
        );
        await ev(
          "new Promise(function(done){requestAnimationFrame(function(){requestAnimationFrame(done);});})",
        );
        const end = await ev(
          "(function(){var el=document.querySelector('.sr-ep.focused');var box=el&&el.getBoundingClientRect();var viewport=document.querySelector('.sr-ep-scroller');var region=viewport.getBoundingClientRect();return {key:el&&el.getAttribute('data-episode-key'),rows:document.querySelectorAll('.sr-ep').length,top:box&&box.top,bottom:box&&box.bottom,viewport:{top:region.top,bottom:region.bottom,height:viewport.clientHeight,scrollTop:viewport.scrollTop,scrollHeight:viewport.scrollHeight}};})()",
        );
        if (
          !end.key?.endsWith(":episode:1000") ||
          end.rows > 14 ||
          end.top < 0 ||
          end.bottom > 1081
        )
          throw new Error(`Episode window failed: ${JSON.stringify(end)}`);
        await ev("document.querySelectorAll('.sr-season')[1].click()");
        await ev(
          "new Promise(function(done){requestAnimationFrame(function(){requestAnimationFrame(done);});})",
        );
        if (
          !(
            await ev(
              "document.querySelector('.sr-ep.focused').getAttribute('data-episode-key')",
            )
          ).endsWith(":episode:1001")
        )
          throw new Error("Second season was not visited");
        await ev("document.querySelectorAll('.sr-season')[0].click()");
        await ev(
          "new Promise(function(done){requestAnimationFrame(function(){requestAnimationFrame(done);});})",
        );
        const restored = await ev(
          "document.querySelector('.sr-ep.focused').getAttribute('data-episode-key')",
        );
        if (restored !== end.key) throw new Error("Season selection was not restored");
        report.episodes = { ...end, restored };
        report.catalogTimings = await ev("window.__catalogTimings");
        if (arg("ui") === "true")
          await runVodLayouts({ ev, capture, report, checkpoint, phase: "episodes" });
      }
    },
  );
  report.status = "passed";
} catch (error) {
  report.error = error.message;
  process.exitCode = 1;
} finally {
  await app.close();
  await new Promise((resolve) => backend.close(resolve));
  rmSync(temporary, { recursive: true, force: true });
  const path = join(
    evidence,
    `vod-windowing-${target}-${arg("engine") ?? "desktop"}-${count}-${locale}.json`,
  );
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report));
}
