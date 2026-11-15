import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, test, vi } from "vitest";

describe("Runtime CSS Variables Polyfill (cssvars.js)", () => {
  const scriptPath = resolve(__dirname, "../public/legacy/cssvars.js");
  const scriptContent = readFileSync(scriptPath, "utf8");

  beforeEach(() => {
    // Reset document
    document.head.innerHTML = "";
    document.body.innerHTML = "";
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-size");
    delete (window as unknown as { CssVars?: unknown }).CssVars;
    delete (window as unknown as { __FORCE_CSSVARS__?: unknown })
      .__FORCE_CSSVARS__;
  });

  test("script file exists and is valid ES5/Chromium 47 compatible JavaScript", () => {
    expect(scriptContent).toBeDefined();
    // Verify no modern arrow functions or const/let outside strings in legacy polyfill
    expect(scriptContent).toContain("function (window, document)");
    expect(scriptContent).toContain("window.CssVars");
  });

  test("skips execution when native CSS variables are supported and not forced", () => {
    // Provide CSS.supports returning true
    (window as unknown as { CSS: unknown }).CSS = {
      supports: vi.fn(() => true),
    };

    const fn = new Function("window", "document", scriptContent);
    fn(window, document);

    expect((window as unknown as { CssVars?: unknown }).CssVars).toBeUndefined();
  });

  test("runs when forced via window.__FORCE_CSSVARS__ = true", () => {
    (window as unknown as { CSS: unknown }).CSS = {
      supports: vi.fn(() => true),
    };
    (window as unknown as { __FORCE_CSSVARS__: boolean }).__FORCE_CSSVARS__ =
      true;

    // Add a test style element
    const style = document.createElement("style");
    style.textContent = `
      :root { --bg: #0a0c0f; --accent: #4c8dff; }
      .card { background: var(--bg); color: var(--accent); }
    `;
    document.head.appendChild(style);

    const fn = new Function("window", "document", scriptContent);
    fn(window, document);

    const cssVars = (
      window as unknown as {
        CssVars: {
          table: () => Record<string, string>;
          render: () => void;
        };
      }
    ).CssVars;
    expect(cssVars).toBeDefined();

    const table = cssVars.table();
    expect(table["--bg"]).toBe("#0a0c0f");
    expect(table["--accent"]).toBe("#4c8dff");

    // Check that a transformed style tag was injected
    const injected = document.querySelector("style[data-cssvars]");
    expect(injected).toBeTruthy();
    expect(injected?.textContent).toContain("background: #0a0c0f");
    expect(injected?.textContent).toContain("color: #4c8dff");
  });

  test("dynamically updates styles when data-theme changes on documentElement", async () => {
    (window as unknown as { __FORCE_CSSVARS__: boolean }).__FORCE_CSSVARS__ =
      true;

    const style = document.createElement("style");
    style.textContent = `
      :root { --bg: #0a0c0f; }
      html[data-theme="oled"] { --bg: #000000; }
      html[data-theme="violet"] { --bg: #1a0b2e; }
      .app { background: var(--bg); }
    `;
    document.head.appendChild(style);

    const fn = new Function("window", "document", scriptContent);
    fn(window, document);

    const cssVars = (
      window as unknown as {
        CssVars: {
          table: () => Record<string, string>;
          render: () => void;
        };
      }
    ).CssVars;

    expect(cssVars.table()["--bg"]).toBe("#0a0c0f");

    // Switch to OLED theme
    document.documentElement.setAttribute("data-theme", "oled");
    cssVars.render();

    expect(cssVars.table()["--bg"]).toBe("#000000");
    const injected = document.querySelector("style[data-cssvars]");
    expect(injected?.textContent).toContain("background: #000000");

    // Switch to Violet theme
    document.documentElement.setAttribute("data-theme", "violet");
    cssVars.render();
    expect(cssVars.table()["--bg"]).toBe("#1a0b2e");
    expect(injected?.textContent).toContain("background: #1a0b2e");
  });

  test("substitutes nested fallback values when variable is undefined", () => {
    (window as unknown as { __FORCE_CSSVARS__: boolean }).__FORCE_CSSVARS__ =
      true;

    const style = document.createElement("style");
    style.textContent = `
      :root { --defined: #ffffff; }
      .box {
        color: var(--defined);
        border-color: var(--missing, #ff0000);
        background: var(--empty, var(--fallback, #123456));
      }
    `;
    document.head.appendChild(style);

    const fn = new Function("window", "document", scriptContent);
    fn(window, document);

    const injected = document.querySelector("style[data-cssvars]");
    expect(injected?.textContent).toContain("color: #ffffff");
    expect(injected?.textContent).toContain("border-color: #ff0000");
    expect(injected?.textContent).toContain("background: #123456");
  });
});
