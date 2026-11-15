/* Independent ES5 startup recovery: runs even when the app entry cannot parse.
 * No storage writes, network, IndexedDB or playback. Removed on React mount.
 */
(function () {
  "use strict";
  var root = document.getElementById("root");
  if (!root) return;
  var started = Date.now();
  var failed = false;
  var timer;
  var messages = {
    en: ["Zappa could not start", "Press OK to retry or Return to exit.", "Retry"],
    sv: ["Zappa kunde inte starta", "Tryck OK för att försöka igen eller Retur för att avsluta.", "Försök igen"],
    ar: ["تعذر بدء تشغيل Zappa", "اضغط موافق للمحاولة مجدداً أو رجوع للخروج.", "إعادة المحاولة"]
  };
  function mounted() { return !!root.querySelector(".app"); }
  function cleanup() {
    failed = false;
    window.clearTimeout(timer);
    window.removeEventListener("keydown", onKey, true);
  }
  function retry() { window.location.reload(); }
  function onKey(event) {
    if (mounted()) { cleanup(); return; }
    if (!failed) return;
    var key = event.keyCode || event.which;
    if (key !== 13 && key !== 10009 && key !== 27) return;
    event.preventDefault();
    event.stopPropagation();
    if (key === 13) retry();
    else if (window.tizen && window.tizen.application) window.tizen.application.getCurrentApplication().exit();
  }
  function recover() {
    failed = true;
    var locale = ((window.navigator && window.navigator.language) || document.documentElement.lang || "en").slice(0, 2);
    try {
      var settings = JSON.parse(window.localStorage.getItem("openiptv.settings") || "{}");
      if (settings.locale && messages[settings.locale]) locale = settings.locale;
    } catch (ignored) { /* Storage may be disabled. */ }
    var copy = messages[locale] || messages.en;
    var card = document.createElement("div");
    card.id = "startup-recovery";
    card.setAttribute("role", "alert");
    card.setAttribute("dir", locale === "ar" ? "rtl" : "ltr");
    card.style.cssText = "position:absolute;top:0;right:0;bottom:0;left:0;background:#000;color:#fff;text-align:center;padding:240px 80px;font:32px sans-serif;";
    var heading = document.createElement("h1");
    heading.textContent = copy[0];
    var detail = document.createElement("p");
    detail.textContent = copy[1];
    var button = document.createElement("button");
    button.textContent = copy[2];
    button.style.cssText = "margin-top:24px;padding:20px 40px;background:#fff;color:#000;border:4px solid #58c7ff;font:32px sans-serif;";
    button.onclick = retry;
    card.appendChild(heading); card.appendChild(detail); card.appendChild(button);
    root.textContent = "";
    root.appendChild(card);
    button.focus();
  }
  function watch() {
    if (mounted()) { cleanup(); return; }
    if (!failed && Date.now() - started >= 15000) recover();
    // A late successful mount must regain normal key handling immediately.
    timer = window.setTimeout(watch, failed ? 1000 : 100);
  }
  window.addEventListener("keydown", onKey, true);
  timer = window.setTimeout(watch, 100);
})();
