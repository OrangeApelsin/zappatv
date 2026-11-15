#!/usr/bin/env node
/** Artifact mount/worker/fallback smoke using fresh desktop profiles and a loopback fixture.
 * This does not verify TV hardware, old-engine APIs or performance budgets.
 * --dir can point at a safely extracted WGT; --target selects its grammar policy.
 */
import { serve } from "./harness.mjs";
import { withBrowser } from "./browser.mjs";
import { findChrome, arg } from "./cdp.mjs";
import { XTREAM_FIXTURE } from "../present.mjs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { checkArtifacts } from "../check-artifacts.mjs";
import { ensureEngine } from "./engines.mjs";
import { platformOf } from "./platforms.mjs";
import { openFixtureMovies } from "./startup-journey.mjs";
const root = resolve(arg("dir") ?? "dist");
const legacy = arg("legacy-fetch");
if (legacy !== undefined && !["true", "false"].includes(legacy))
  throw new Error("Use --legacy-fetch=true or false.");
const legacyFetchForced = legacy === "true";
const artifact = checkArtifacts({
  root,
  target: arg("target") ?? process.env.TIZEN_TARGET ?? "5.5",
});
const engine = arg("engine") && platformOf(arg("engine"));
if (arg("engine") && !engine) throw new Error("Unknown engine target.");
const binary = arg("binary") || (engine ? await ensureEngine(engine) : findChrome());
if (!binary) throw new Error("Chrome or CHROME_PATH required; missing browser is not a pass.");
const server = await serve(root);
const origin = `http://127.0.0.1:${server.port}`;
// A widget calls a different origin. M63 defaults Request credentials to omit;
// using the app origin here would exercise an unsupported XHR cookie-omission policy.
const backend = await serve(root);
const providerOrigin = `http://127.0.0.1:${backend.port}`;
const records = [];
try {
  for (const mode of [
    "http",
    "file",
    "unsupported",
    "silent",
    "minimal",
    "clean",
    "recovery",
  ]) {
    const result = await withBrowser(
      binary,
      [
        ...(engine && engine.chromium < 59 ? [] : ["--headless"]),
        "--no-sandbox",
        "--disable-gpu",
        "--disable-background-networking",
        "--no-first-run",
        "--window-size=1920,1080",
      ],
      "zappa-worker-smoke-",
      async (cdp) => {
        const exceptions = [];
        const version = await cdp.send("Browser.getVersion");
        if (
          engine &&
          Number(/(?:Chrome|Chromium)\/(\d+)/.exec(version.product)?.[1]) !== engine.chromium
        )
          throw new Error(`Expected M${engine.chromium}; browser reports ${version.product}.`);
        cdp.on("Runtime.exceptionThrown", (e) =>
          exceptions.push(
            e.exceptionDetails?.exception?.description ?? e.exceptionDetails?.text,
          ),
        );
        await cdp.send("Runtime.enable");
        await cdp.send("Page.enable");
        await cdp.send("Network.enable");
        await cdp.send("Network.setBlockedURLs", {
          urls: ["*example.invalid*", ...(mode === "recovery" ? ["*assets/index-*.js"] : [])],
        });
        await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
          source: `(function(){
    if(location.protocol==='about:')return;
    window.__platformProbe={abort:'signal' in Request.prototype,requestCache:'cache' in Request.prototype,wasm:typeof WebAssembly==='object',idle:typeof requestIdleCallback==='function',resize:typeof ResizeObserver==='function'};
    if(${legacyFetchForced || mode === "minimal"}){window.AbortController=undefined;window.AbortSignal=undefined;}
    if(${JSON.stringify(mode)}==='minimal'){window.WebAssembly=undefined;window.ResizeObserver=undefined;window.requestIdleCallback=undefined;window.TextEncoder=undefined;window.TextDecoder=undefined;Object.defineProperty(window,'indexedDB',{value:undefined,configurable:true});}
    if(${JSON.stringify(mode)}!=='clean')localStorage.setItem('openiptv.settings',JSON.stringify({playlists:[{id:'worker-fixture',name:'Fixture',source:{kind:'xtream',server:${JSON.stringify(providerOrigin)},username:${JSON.stringify(XTREAM_FIXTURE.username)},password:${JSON.stringify(XTREAM_FIXTURE.password)},output:'m3u8'},sourceVersion:1,hiddenCategories:[],hiddenCategoryMode:'exclude'}],activePlaylistId:'worker-fixture',resumeLast:false,panelTimeout:0,showClock:false,locale:'en'}));
    localStorage.setItem('zappa.viewMode','grid');
    window.__workerProbe={requests:[],ready:false,terminated:false,posted:0};
    var Native=window.Worker;
    if(${JSON.stringify(mode)}==='unsupported'||${JSON.stringify(mode)}==='minimal'){window.Worker=undefined;return;}
    window.Worker=function(url,options){
      var probe=window.__workerProbe;
      probe.requests.push({url:String(url),type:options&&options.type||'classic'});
      if(${JSON.stringify(mode)}==='silent')return {postMessage:function(){probe.posted++;},terminate:function(){probe.terminated=true;}};
      var worker=new Native(url,options);
      worker.addEventListener('message',function(e){if(e.data&&e.data.ready===true)probe.ready=true;});
      return worker;
    };
    window.Worker.prototype=Native.prototype;
   })();`,
        });
        await cdp.send("Page.navigate", {
          url: mode === "file" ? pathToFileURL(resolve(root, "index.html")).href : `${origin}/`,
        });
        const ev = async (expression) => {
          const result = await cdp.send("Runtime.evaluate", {
            expression,
            returnByValue: true,
            awaitPromise: true,
          });
          if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
          return result.result.value;
        };
        let clicked = false;
        let sample;
        const deadline = Date.now() + (mode === "recovery" ? 20000 : 15000);
        do {
          await new Promise((r) => setTimeout(r, 100));
          if (!clicked) {
            await ev(
              "new Promise(function(done){requestAnimationFrame(function(){requestAnimationFrame(done);});})",
            );
            clicked = await ev(
              `(${openFixtureMovies.toString()})()`,
            );
          }
          sample = await ev(
            `JSON.stringify({tiles:document.querySelectorAll('.vod-tile').length,probe:window.__workerProbe,mounted:!!document.querySelector('#root>.app'),onboarding:!!document.querySelector('.onboard button'),recovery:!!document.querySelector('#startup-recovery button'),failure:document.querySelector('.vod-tile')?'':document.body.innerText.slice(-400),nativeCapabilities:window.__platformProbe,capabilities:{indexedDB:typeof indexedDB!=='undefined',nativeAbort:'signal' in Request.prototype,requestCache:'cache' in Request.prototype,wasm:typeof WebAssembly==='object',idle:typeof requestIdleCallback==='function',resize:typeof ResizeObserver==='function'}})`,
          );
          sample = JSON.parse(sample);
        } while (
          !(mode === "clean"
            ? sample.onboarding
            : mode === "recovery"
              ? sample.recovery
              : sample.tiles) &&
          Date.now() < deadline
        );
        return {
          mode,
          moviesSelected: clicked,
          browser: (await cdp.send("Browser.getVersion")).product,
          ...sample,
          exceptions,
        };
      },
    );
    console.log(JSON.stringify(result));
    const expected =
      mode === "file"
        ? pathToFileURL(resolve(root, artifact.worker)).href
        : new URL(artifact.worker, `${origin}/`).href;
    if (
      result.probe.requests.some(
        (request) => request.url !== expected || request.type !== "classic",
      )
    )
      throw new Error("Lazy worker URL/type does not match the packaged classic worker.");
    const noWorker = ["unsupported", "minimal", "clean", "recovery"].includes(mode);
    if (!noWorker && result.probe.requests.length !== 1)
      throw new Error("Expected one worker owner.");
    if (noWorker && result.probe.requests.length)
      throw new Error("Unsupported workers must not be constructed.");
    records.push(result);
    if (
      !(mode === "clean"
        ? result.onboarding && result.mounted
        : mode === "recovery"
          ? result.recovery && !result.mounted
          : result.tiles && result.mounted) ||
      result.exceptions.length ||
      (mode === "http" && !result.probe.ready) ||
      (mode === "silent" && (!result.probe.terminated || result.probe.posted))
    )
      throw new Error(`Worker smoke failed: ${mode}`);
  }
  console.log(
    JSON.stringify({
      target: artifact.target,
      legacyFetchForced,
      engine: engine?.tizen ?? "installed desktop",
      scripts: artifact.scripts,
      simulation: true,
      modes: records.map((result) => result.mode),
    }),
  );
} finally {
  await Promise.all([server.close(), backend.close()]);
}
