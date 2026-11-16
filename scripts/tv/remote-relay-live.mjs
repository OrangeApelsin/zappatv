/** Real HTTPS relay integration using a disposable extracted-widget profile.
 * Creates and retires its own TV registration. Never reads owner TV state.
 * Desktop engine evidence does not establish Samsung hardware acceptance.
 */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { arg } from "./cdp.mjs";
import { ensureEngine } from "./engines.mjs";
import { withBrowser } from "./browser.mjs";
import { checkArtifacts } from "../check-artifacts.mjs";
import { platformOf } from "./platforms.mjs";

const root = resolve(arg("dir") ?? "dist");
const base = new URL(arg("relay"));
if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash || !base.pathname.endsWith("/")) {
  throw new Error("Provide an HTTPS relay prefix ending in / without credentials or query");
}
const engine = platformOf(arg("engine") ?? "5.0");
if (!engine) throw new Error("Unknown engine");
checkArtifacts({ root, target: arg("target") ?? "5.0" });
const binary = await ensureEngine(engine);

for (const transport of ["websocket", "polling"]) {
  const result = await withBrowser(binary, ["--headless", "--no-sandbox", "--disable-gpu", "--no-first-run", "--window-size=1920,1080"], "zappa-live-relay-", async (cdp) => {
    let owner;
    const exceptions = [];
    const sockets = [];
    let socketRequests = 0;
    cdp.on("Runtime.exceptionThrown", () => exceptions.push("Uncaught browser exception"));
    cdp.on("Network.webSocketCreated", ({ url }) => sockets.push(url));
    cdp.on("Network.webSocketFrameReceived", ({ response }) => {
      try { if (JSON.parse(response.payloadData).type === "request") socketRequests++; } catch { /* Non-JSON frames cannot establish relay delivery. */ }
    });
    await cdp.send("Runtime.enable");
    await cdp.send("Network.enable");
    await cdp.send("Page.enable");
    const version = await cdp.send("Browser.getVersion");
    if (Number(/(?:Chrome|Chromium)\/(\d+)/.exec(version.product)?.[1]) !== engine.chromium) throw new Error("Wrong engine binary");
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: `
      window.WebAssembly = undefined; window.Worker = undefined;
      window.webapis = {avplay:{}};
      ${transport === "polling" ? "window.WebSocket = undefined;" : ""}
      if (!localStorage.getItem('zappa.remote.relayUrl')) {
        localStorage.setItem('zappa.remote.relayUrl', ${JSON.stringify(base.href)});
        localStorage.setItem('openiptv.settings', JSON.stringify({locale:'en',playlists:[]}));
      }
    ` });
    const evaluate = async (expression) => {
      const value = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (value.exceptionDetails) throw new Error("Browser evaluation failed");
      return value.result.value;
    };
    const wait = async (expression) => {
      const until = Date.now() + 30000;
      do {
        if (await evaluate(expression)) return;
        await new Promise((done) => setTimeout(done, 150));
      } while (Date.now() < until);
      throw new Error("Timed out waiting for relay UI");
    };
    const phone = async (operation, body, auth, expected = 200) => {
      const response = await fetch(new URL(`t/${owner.tvId}/api/v1/${operation}`, base), {
        method: body === undefined ? "GET" : "POST",
        headers: { Origin: base.origin, ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(auth ? { Authorization: auth } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(35000),
      });
      if (response.status !== expected) throw new Error(`Phone ${operation}: expected ${expected}, got ${response.status}`);
      if (!response.headers.get("cache-control")?.includes("no-store")) throw new Error("Phone response must not be cached");
      return response.json();
    };
    try {
      await cdp.send("Page.navigate", { url: pathToFileURL(resolve(root, "index.html")).href });
      await wait("!!document.querySelector('.setup-tabs button')");
      await evaluate("document.querySelector('.setup-tabs button').click()");
      await wait("!!document.querySelector('#pair-code:not(.blank)')");
      owner = await evaluate(`JSON.parse(localStorage.getItem('zappa.remote.relayOwners'))[${JSON.stringify(base.href)}]`);
      if (!owner?.tvId || !owner.ownershipSecret) throw new Error("Missing disposable owner");
      const code = await evaluate("document.querySelector('#fields-phone').textContent.match(/(\\d{3}) (\\d{3})/).slice(1).join('')");
      const first = await phone("pair", { name: "Integration phone one", code });
      if (!first.ok || !first.deviceId || !first.credential) throw new Error("Pairing failed");
      const authorization = `Bearer ${first.deviceId}:${first.credential}`;
      const state = await phone("state", undefined, authorization);
      const changed = await phone("command", { id: "integration-setting", revision: state.revision, command: { type: "setting", key: "showClock", value: !state.settings.showClock } }, authorization);
      if (changed.snapshot.settings.showClock === state.settings.showClock) throw new Error("Setting was not applied");
      // A full widget restart must retain ownership, phone credentials and settings.
      await cdp.send("Page.reload");
      await wait("!!document.querySelector('.setup-tabs button')");
      await evaluate("document.querySelector('.setup-tabs button').click()");
      await wait("!!document.querySelector('#pair-code:not(.blank)')");
      const restored = await evaluate(`JSON.parse(localStorage.getItem('zappa.remote.relayOwners'))[${JSON.stringify(base.href)}]`);
      if (restored.tvId !== owner.tvId || restored.ownershipSecret !== owner.ownershipSecret) throw new Error("Ownership changed on restart");
      const after = await phone("state", undefined, authorization);
      if (after.settings.showClock !== changed.snapshot.settings.showClock) throw new Error("Setting lost on restart");
      if (transport === "websocket" && (sockets.length < 2 || socketRequests < 4)) throw new Error("Native WebSocket was not used");
      if (transport === "polling" && sockets.length) throw new Error("Polling unexpectedly opened a socket");
      if (exceptions.length) throw new Error("Uncaught browser exception");
      return { browser: version.product, transport, relay: base.href, paired: true, settingChanged: true, restartRetained: true, tlsVerified: true, hardwareTested: false };
    } finally {
      // Recover ownership even when initial readiness failed, then retire only our TV.
      owner ??= await evaluate(`JSON.parse(localStorage.getItem('zappa.remote.relayOwners') || '{}')[${JSON.stringify(base.href)}]`).catch(() => undefined);
      if (owner) {
        const response = await fetch(new URL(`api/relay/v1/tvs/${owner.tvId}/retire`, base), {
          method: "POST", headers: { Authorization: `Bearer ${owner.ownershipSecret}`, "Content-Type": "application/json" }, body: "{}", signal: AbortSignal.timeout(10000),
        });
        // biome-ignore lint/correctness/noUnsafeFinally: Cleanup failure must fail qualification, never report a pass with an active disposable registration.
        if (!response.ok) throw new Error(`Disposable TV retirement failed: ${response.status}`);
      }
    }
  });
  console.log(JSON.stringify(result));
}
