/* biome-ignore-all lint/complexity/useArrowFunction: The serialized browser fixture deliberately uses ES5 syntax. */
/** Packaged TV relay journey on pinned Chromium, using a protocol fixture.
 * Proves client execution/DOM behavior, not networking, server security or TV hardware.
 */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { arg } from "./cdp.mjs";
import { ensureEngine } from "./engines.mjs";
import { withBrowser } from "./browser.mjs";
import { serve } from "./harness.mjs";
import { checkArtifacts } from "../check-artifacts.mjs";
import { platformOf } from "./platforms.mjs";

const root = resolve(arg("dir") ?? "dist");
const engine = platformOf(arg("engine") ?? "5.0");
if (!engine) throw new Error("Unknown engine");
const locale = arg("locale") ?? "en";
if (!["en", "sv", "ar"].includes(locale)) throw new Error("Unknown locale");
checkArtifacts({ root, target: arg("target") ?? "5.0" });
const binary = await ensureEngine(engine);
const server = await serve(root);

// Executed as ES5 in the old engine. All secrets stay in this disposable profile.
function fixture(transport, locale) {
  window.WebAssembly = undefined;
  window.Worker = undefined;
  window.webapis = { avplay: {} };
  localStorage.setItem("zappa.remote.relayUrl", "https://relay.test/prefix/");
  localStorage.setItem("openiptv.settings", JSON.stringify({ locale: locale, playlists: [] }));
  var probe = { requests: [], responses: [], messages: [], generation: "g1", transport: transport };
  window.__relayProbe = probe;
  var NativeXHR = window.XMLHttpRequest;
  function Xhr() { this.headers = {}; this.responseText = ""; this.status = 200; }
  Xhr.prototype.open = function (method, url) { this.method = method; this.url = url; };
  Xhr.prototype.setRequestHeader = function (name, value) { this.headers[name] = value; };
  Xhr.prototype.abort = function () { clearTimeout(this.timer); if (this.onabort) this.onabort(); };
  Xhr.prototype.send = function (body) {
    var self = this;
    var data = body ? JSON.parse(body) : {};
    probe.requests.push(this.url);
    var result = {};
    if (/capabilities$/.test(this.url)) result = { protocolVersion: 1, transports: transport === "websocket" ? ["websocket", "polling"] : ["polling"] };
    else if (/\/tvs$/.test(this.url)) result = { tvId: "fixture-tv", ownershipSecret: "fixture-owner-secret" };
    else if (/\/connections$/.test(this.url)) result = { generation: probe.generation, credential: "fixture-connection-secret", serverTime: Date.now() };
    else if (/socket-ticket$/.test(this.url)) result = { ticket: "fixture-one-use-ticket" };
    else if (/\/messages$/.test(this.url) && data.type === "response") probe.responses.push(data);
    this.timer = setTimeout(function () {
      if (/\/poll$/.test(self.url)) result = { messages: probe.messages.splice(0) };
      self.responseText = JSON.stringify(result);
      if (self.onload) self.onload();
    }, /\/poll$/.test(this.url) ? 100 : 0);
  };
  window.XMLHttpRequest = function () {
    var fake = new Xhr();
    var open = fake.open;
    fake.open = function (method, url) {
      if (url.indexOf("https://relay.test/") === 0) return open.call(fake, method, url);
      throw new Error("Unexpected network request in isolated relay fixture");
    };
    return fake;
  };
  // Keep the native constructor available to diagnose accidental replacement scope.
  probe.nativeXHR = typeof NativeXHR === "function";
  function Socket(url) {
    this.url = url; this.readyState = 0; this.bufferedAmount = 0; probe.socket = this;
    var self = this;
    setTimeout(function () { self.readyState = 1; if (self.onopen) self.onopen(); }, 0);
  }
  Socket.prototype.send = function (text) {
    var data = JSON.parse(text); var self = this;
    if (data.type === "authenticate") setTimeout(function () { if (self.onmessage) self.onmessage({ data: JSON.stringify({ type: "ready", generation: probe.generation }) }); }, 0);
    if (data.type === "response") probe.responses.push(data);
  };
  Socket.prototype.close = function () { this.readyState = 3; };
  window.WebSocket = Socket;
  probe.deliver = function (path, method, body, authorization) {
    probe.next = (probe.next || 0) + 1;
    var message = { type: "request", id: String(probe.next),
      tvId: "fixture-tv", generation: probe.generation, deadline: Date.now() + 1500,
      path: path, method: method, headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) };
    if (authorization) message.headers.authorization = authorization;
    if (transport === "websocket") probe.socket.onmessage({ data: JSON.stringify(message) });
    else probe.messages.push(message);
  };
}

try {
  for (const origin of ["http", "file"]) for (const transport of ["websocket", "polling"]) {
    const result = await withBrowser(binary, ["--headless", "--no-sandbox", "--disable-gpu", "--no-first-run", "--window-size=1920,1080"], "zappa-relay-", async (cdp) => {
      const exceptions = [];
      cdp.on("Runtime.exceptionThrown", (event) => exceptions.push(event.exceptionDetails.text));
      await cdp.send("Runtime.enable"); await cdp.send("Page.enable");
      const version = await cdp.send("Browser.getVersion");
      if (Number(/(?:Chrome|Chromium)\/(\d+)/.exec(version.product)?.[1]) !== engine.chromium) throw new Error("Wrong engine binary");
      await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: `(${fixture.toString()})(${JSON.stringify(transport)},${JSON.stringify(locale)})` });
      const evaluate = async (expression) => {
        const value = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
        if (value.exceptionDetails) throw new Error(value.exceptionDetails.exception?.description ?? value.exceptionDetails.text);
        return value.result.value;
      };
      const wait = async (expression) => {
        const until = Date.now() + 12000;
        do {
          if (await evaluate(expression)) return;
          await new Promise((done) => setTimeout(done, 100));
        } while (Date.now() < until);
        throw new Error(`Timed out: ${expression}`);
      };
      await cdp.send("Page.navigate", { url: origin === "file" ? pathToFileURL(resolve(root, "index.html")).href : `http://127.0.0.1:${server.port}/` });
      await wait("!!document.querySelector('.setup-tabs button')");
      await evaluate("document.querySelector('.setup-tabs button').click()");
      await wait("!!document.querySelector('#pair-code:not(.blank)')");
      await evaluate(`(function(){var text=document.querySelector('#fields-phone').textContent;var code=/(\\d{3}) (\\d{3})/.exec(text);if(!code)throw new Error('Missing manual pairing code');window.__relayProbe.deliver('/api/v1/pair','POST',{name:'Fixture phone',code:code[1]+code[2]});})()`);
      await wait("window.__relayProbe.responses.length === 1");
      await evaluate(`(function(){var probe=window.__relayProbe;var pair=JSON.parse(probe.responses[0].body);if(!pair.ok)throw new Error('Pair failed');probe.authorization='Bearer '+pair.deviceId+':'+pair.credential;probe.deliver('/api/v1/state','GET',{},probe.authorization);})()`);
      await wait("window.__relayProbe.responses.length === 2");
      await evaluate(`(function(){var probe=window.__relayProbe;var state=JSON.parse(probe.responses[1].body);probe.deliver('/api/v1/command','POST',{id:'setting-one',revision:state.revision,command:{type:'setting',key:'showClock',value:false}},probe.authorization);})()`);
      await wait("window.__relayProbe.responses.length === 3");
      const observed = await evaluate(`(function(){var probe=window.__relayProbe;return {statuses:probe.responses.map(function(r){return r.status;}),changed:JSON.parse(probe.responses[2].body).snapshot.settings.showClock===false,wasm:typeof WebAssembly,worker:typeof Worker,configured:!!document.querySelector('#remote-relay-url'),phoneUrl:document.body.textContent.indexOf('https://relay.test/prefix/t/fixture-tv/')!==-1};})()`);
      if (observed.statuses.some((status) => status !== 200) || !observed.changed || observed.wasm !== "undefined" || observed.worker !== "undefined" || !observed.configured || exceptions.length) throw new Error(JSON.stringify({ observed, exceptions }));
      return { browser: version.product, origin, transport, locale, ...observed, exceptions, simulation: true, hardwareTested: false };
    });
    console.log(JSON.stringify(result));
  }
} finally { await server.close(); }
