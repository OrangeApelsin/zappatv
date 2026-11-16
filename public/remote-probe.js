/* Isolated classic-script diagnostics. Never access application storage or WASM. */
(function () {
  var output = document.getElementById("result");
  var socket = null;
  var timer = null;
  function report(text) { output.textContent += text + "\n"; }
  function close() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (socket) socket.close();
    socket = null;
  }
  document.getElementById("close").onclick = close;
  document.getElementById("probe").onsubmit = function (event) {
    event.preventDefault();
    output.textContent = "";
    try {
      var base = new URL(document.getElementById("url").value);
      if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash) throw new Error("Use an HTTPS URL without credentials, query or fragment");
      base.pathname = base.pathname.replace(/\/$/, "") + "/";
      var xhr = new XMLHttpRequest();
      xhr.open("GET", new URL("api/relay/v1/capabilities", base.href).href);
      xhr.timeout = 10000;
      xhr.onload = function () {
        try {
          var data = JSON.parse(xhr.responseText);
          report(xhr.status === 200 && data.protocolVersion === 1 ? "HTTPS/XHR capabilities: PASS" : "HTTPS/XHR capabilities: FAIL");
        } catch (_error) { report("HTTPS/XHR invalid response"); }
      };
      xhr.onerror = xhr.ontimeout = function () { report("HTTPS/XHR failed: inspect origin, certificate and connectivity"); };
      xhr.send();
      var bytes = new Uint8Array(32);
      crypto.getRandomValues(bytes);
      if (!crypto.subtle || typeof TextEncoder === "undefined") throw new Error("Required crypto/encoding API unavailable");
      crypto.subtle.digest("SHA-256", bytes).then(function () { report("Randomness and SHA-256: PASS"); }, function () { report("SHA-256: FAIL"); });
      report("Origin: " + location.protocol + " (record TV model/firmware and WGT hash separately)");
    } catch (_error) { report("Invalid configuration or missing crypto APIs"); }
  };
  document.getElementById("socket").onsubmit = function (event) {
    event.preventDefault();
    close();
    try {
      var url = new URL(document.getElementById("ws").value);
      if (url.protocol !== "wss:" || url.username || url.password || url.search || url.hash) throw new Error("Invalid socket URL");
      var ticket = document.getElementById("ticket").value;
      document.getElementById("ticket").value = "";
      socket = new WebSocket(url.href);
      var current = socket;
      current.onopen = function () { current.send(JSON.stringify({type:"authenticate",protocolVersion:1,ticket:ticket})); ticket = ""; report("WebSocket open; awaiting server acknowledgement"); };
      current.onmessage = function (message) {
        try {
          var data = JSON.parse(message.data);
          if (data.type === "ready") { report("WebSocket authenticated: PASS"); }
          else if (data.type === "request") { report("Phone-to-TV request received (payload hidden)"); }
        } catch (_error) { report("Invalid server frame"); }
      };
      current.onerror = function () { report("WebSocket: FAIL"); };
      current.onclose = function () { ticket = ""; report("WebSocket closed"); };
      timer = setTimeout(close, 45000);
    } catch (_error) { report("WebSocket configuration/capability: FAIL"); }
  };
  window.addEventListener("pagehide", close);
})();
