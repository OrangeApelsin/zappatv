/**
 * Runtime CSS Custom Properties (CSS Variables) Polyfill for Chromium 47 (Tizen 3.0).
 *
 * Chromium 47 does not support native CSS custom properties (var(--...)), which
 * arrived in Chromium 49.
 *
 * This polyfill:
 * 1. Skips execution if native CSS custom properties are supported (unless forced via ?cssvars or window.__FORCE_CSSVARS__).
 * 2. Synchronously reads all `<link rel="stylesheet">` and `<style>` elements in <head>.
 * 3. Parses :root, html, and selector-scoped custom property definitions (--*).
 * 4. Injects `<style data-cssvars="...">` with resolved CSS values and disables original <link> tags.
 * 5. Uses MutationObserver to observe document.documentElement attribute changes (data-theme, data-size, class)
 *    and dynamically re-renders transformed styles upon theme change.
 * 6. Exposes window.CssVars = { render, table } for testing and manual re-renders.
 */
(function (window, document) {
  "use strict";

  var forcePolyfill =
    Boolean(window.__FORCE_CSSVARS__) ||
    /[?&]cssvars\b/.test(window.location ? window.location.search : "");

  try {
    if (
      !forcePolyfill &&
      window.CSS &&
      typeof window.CSS.supports === "function" &&
      window.CSS.supports("color", "var(--a)")
    ) {
      return;
    }
  } catch (_e) {}

  var docEl = document.documentElement;
  var matchesSelector =
    docEl.matches ||
    docEl.webkitMatchesSelector ||
    docEl.mozMatchesSelector ||
    docEl.msMatchesSelector;

  var styleSheets = [];
  var inlineCustomProps = {};
  var varRegex =
    /var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\)[^()]*)*))?\)/g;

  function fetchCss(url) {
    try {
      var xhr = new XMLHttpRequest();
      xhr.open("GET", url, false); // synchronous XHR for immediate initial paint
      xhr.send(null);
      if ((xhr.status >= 200 && xhr.status < 300) || xhr.status === 0) {
        return xhr.responseText || "";
      }
    } catch (_err) {}
    return null;
  }

  function resolveUrls(cssText, baseUrl) {
    var anchor = document.createElement("a");
    return cssText.replace(
      /url\(\s*(["']?)([^"')]+)\1\s*\)/g,
      function (match, quote, relUrl) {
        if (/^(data:|[a-z][a-z0-9+.-]*:|#)/i.test(relUrl)) {
          return match;
        }
        anchor.href = baseUrl.replace(/[^\/]*$/, "") + relUrl;
        return "url(" + quote + anchor.href + quote + ")";
      }
    );
  }

  function parseRules(cssText) {
    var rules = [];
    var stripped = cssText.replace(/\/\*[\s\S]*?\*\//g, "");
    var blockRegex = /([^{}]+)\{([^{}]*)\}/g;
    var match;

    while ((match = blockRegex.exec(stripped)) !== null) {
      var selector = match[1].replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
      var body = match[2];

      if (/(^|[;\s])--[\w-]+\s*:/.test(body)) {
        var decls = {};
        var parts = body.split(";");
        for (var i = 0; i < parts.length; i++) {
          var declMatch = /^\s*(--[\w-]+)\s*:\s*([\s\S]*?)\s*$/.exec(parts[i]);
          if (declMatch) {
            decls[declMatch[1]] = declMatch[2].trim();
          }
        }
        rules.push({ sel: selector, decls: decls });
      }
    }
    return rules;
  }

  function selectorMatches(sel) {
    if (!matchesSelector) return false;
    try {
      // Direct matches on documentElement (e.g. :root, html, html[data-theme="..."], [data-theme="..."])
      if (matchesSelector.call(docEl, sel)) return true;
      if (sel === ":root" || sel === "html") return true;
      return false;
    } catch (_e) {
      return false;
    }
  }

  function computeTable() {
    var table = {};
    var i, j, prop;

    for (i = 0; i < styleSheets.length; i++) {
      var sheet = styleSheets[i];
      for (j = 0; j < sheet.defs.length; j++) {
        var rule = sheet.defs[j];
        if (selectorMatches(rule.sel)) {
          for (prop in rule.decls) {
            if (Object.prototype.hasOwnProperty.call(rule.decls, prop)) {
              table[prop] = rule.decls[prop];
            }
          }
        }
      }
    }

    for (prop in inlineCustomProps) {
      if (Object.prototype.hasOwnProperty.call(inlineCustomProps, prop)) {
        table[prop] = inlineCustomProps[prop];
      }
    }

    // Resolve nested variable references (up to 8 passes)
    var resolved = {};
    for (prop in table) {
      if (Object.prototype.hasOwnProperty.call(table, prop)) {
        resolved[prop] = substituteVars(table[prop], table);
      }
    }
    return resolved;
  }

  function substituteVars(cssText, table) {
    var text = cssText;
    for (var pass = 0; pass < 8 && text.indexOf("var(") >= 0; pass++) {
      text = text.replace(varRegex, function (_match, varName, fallback) {
        if (Object.prototype.hasOwnProperty.call(table, varName)) {
          return table[varName];
        }
        return fallback != null ? fallback : "unset";
      });
    }
    return text;
  }

  var lastRenderedJson = "";

  function render() {
    var table = computeTable();
    var tableJson = JSON.stringify(table);
    if (tableJson !== lastRenderedJson) {
      lastRenderedJson = tableJson;
      for (var i = 0; i < styleSheets.length; i++) {
        var sheet = styleSheets[i];
        sheet.style.textContent = substituteVars(sheet.rawCss, table);
      }
    }
  }

  var debounceTimer = null;
  function scheduleRender() {
    if (debounceTimer) return;
    debounceTimer = setTimeout(function () {
      debounceTimer = null;
      render();
    }, 0);
  }

  function init() {
    var links = document.querySelectorAll('link[rel="stylesheet"]');
    var i;

    for (i = 0; i < links.length; i++) {
      var link = links[i];
      var href = link.href || link.getAttribute("href");
      var cssContent = fetchCss(href);
      if (cssContent != null) {
        var style = document.createElement("style");
        style.setAttribute("data-cssvars", link.getAttribute("href") || "link");
        link.parentNode.insertBefore(style, link.nextSibling);
        styleSheets.push({
          element: link,
          style: style,
          rawCss: resolveUrls(cssContent, href),
          defs: parseRules(cssContent),
        });
      }
    }

    // Also collect inline <style> tags if any exist
    var styles = document.querySelectorAll("style:not([data-cssvars])");
    for (i = 0; i < styles.length; i++) {
      var inlineStyle = styles[i];
      var inlineCss = inlineStyle.textContent || "";
      if (inlineCss.indexOf("--") >= 0) {
        var outStyle = document.createElement("style");
        outStyle.setAttribute("data-cssvars", "inline-" + i);
        inlineStyle.parentNode.insertBefore(outStyle, inlineStyle.nextSibling);
        styleSheets.push({
          element: inlineStyle,
          style: outStyle,
          rawCss: inlineCss,
          defs: parseRules(inlineCss),
        });
        inlineStyle.disabled = true;
      }
    }

    if (styleSheets.length > 0) {
      render();
      // Disable original <link> elements to avoid duplicate rendering
      for (i = 0; i < styleSheets.length; i++) {
        if (styleSheets[i].element.tagName === "LINK") {
          styleSheets[i].element.disabled = true;
        }
      }
    }

    // Patch CSSStyleDeclaration for dynamic element.style.setProperty('--var', 'val')
    var proto = window.CSSStyleDeclaration && CSSStyleDeclaration.prototype;
    if (proto) {
      var origSetProperty = proto.setProperty;
      var origGetPropertyValue = proto.getPropertyValue;
      var origRemoveProperty = proto.removeProperty;

      proto.setProperty = function (prop, val) {
        if (typeof prop !== "string" || prop.indexOf("--") !== 0) {
          return origSetProperty.apply(this, arguments);
        }
        if (this === docEl.style) {
          inlineCustomProps[prop] = String(val);
          scheduleRender();
        }
      };

      proto.getPropertyValue = function (prop) {
        if (typeof prop === "string" && prop.indexOf("--") === 0) {
          if (this === docEl.style) {
            return Object.prototype.hasOwnProperty.call(inlineCustomProps, prop)
              ? inlineCustomProps[prop]
              : "";
          }
          var currentTable = computeTable();
          return Object.prototype.hasOwnProperty.call(currentTable, prop)
            ? currentTable[prop]
            : "";
        }
        return origGetPropertyValue.apply(this, arguments);
      };

      proto.removeProperty = function (prop) {
        if (typeof prop === "string" && prop.indexOf("--") === 0) {
          if (
            this === docEl.style &&
            Object.prototype.hasOwnProperty.call(inlineCustomProps, prop)
          ) {
            var old = inlineCustomProps[prop];
            delete inlineCustomProps[prop];
            scheduleRender();
            return old;
          }
          return "";
        }
        return origRemoveProperty.apply(this, arguments);
      };
    }

    // Observe document.documentElement for data-theme, data-size, and class mutations
    if (window.MutationObserver) {
      var observer = new MutationObserver(scheduleRender);
      observer.observe(docEl, {
        attributes: true,
        attributeFilter: ["data-theme", "data-size", "class"],
      });
    }

    window.CssVars = {
      render: render,
      table: computeTable,
      init: init,
      parseRules: parseRules,
      substituteVars: substituteVars,
    };
  }

  // Auto-initialize when DOM is ready, or immediately if already loaded
  if (
    document.readyState === "complete" ||
    document.readyState === "interactive"
  ) {
    init();
  } else {
    document.addEventListener("DOMContentLoaded", init);
  }
})(typeof window !== "undefined" ? window : this, typeof document !== "undefined" ? document : {});
