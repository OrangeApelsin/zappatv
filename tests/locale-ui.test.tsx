import { existsSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, test } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { KEY } from "../src/hooks/useRemote";
import { applyDocumentLocale, type Locale, LOCALES } from "../src/services/locale";
import { mountApp, panelOpen, press } from "./support/app";
import "../src/styles/app.css";

const fontsPath = "public/fonts/fonts.css";
const bundledFontCss = existsSync(fontsPath) ? readFileSync(fontsPath, "utf8") : "";
const fontStyle = document.createElement("style");
fontStyle.textContent = `${bundledFontCss}\n${readFileSync("src/styles/tokens.css", "utf8")}`;
document.head.append(fontStyle);

function fontCovers(family: string, character: string): boolean {
  const point = character.codePointAt(0) ?? 0;
  const blocks = [...bundledFontCss.matchAll(/@font-face\s*\{([^}]*)\}/g)].map(
    (match) => match[1],
  );
  for (const block of blocks) {
    if (!new RegExp(`font-family:\\s*["']${family}["']`).test(block)) continue;
    const declaration = block.match(/unicode-range:\s*([^;]+)/)?.[1];
    if (!declaration) continue;
    for (const rawRange of declaration.split(",")) {
      const range = rawRange.trim().slice(2);
      const [rawStart, rawEnd = rawStart] = range.split("-");
      const start = Number.parseInt(rawStart.replaceAll("?", "0"), 16);
      const end = Number.parseInt(rawEnd.replaceAll("?", "F"), 16);
      if (start <= point && point <= end) return true;
    }
  }
  return false;
}

const PLAYLIST = `#EXTM3U
#EXTINF:-1 tvg-id="a" group-title="News",Alpha
http://example.invalid/a.m3u8`;

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

test("each locale uses the font designed for its writing system", () => {
  const families: [string, Locale[]][] = [
    ["Google Sans", ["en", "sv"]],
    ["Vazirmatn", ["ar"]],
  ];

  expect(families.flatMap(([, locales]) => locales).sort()).toEqual([...LOCALES].sort());
  for (const [family, locales] of families) {
    for (const locale of locales) {
      applyDocumentLocale(locale);
      expect(getComputedStyle(document.documentElement).getPropertyValue("--font")).toContain(
        `"${family}"`,
      );
    }
  }
});

test("only Latin and Arabic web fonts ship; other scripts use explicit system fallback", () => {
  const fontUrls = [...bundledFontCss.matchAll(/url\(["']?(\/fonts\/[^)"']+)["']?\)/g)].map(
    (match) => match[1],
  );
  expect(fontUrls).toHaveLength(6);
  for (const url of fontUrls) expect(existsSync(`public${url}`)).toBe(true);
  for (const char of "ÅÄÖåäö") expect(fontCovers("Google Sans", char)).toBe(true);
  expect(fontCovers("Noto Sans SC", "龍")).toBe(false);
  expect(bundledFontCss).toContain("system-ui");
  expect(bundledFontCss).not.toMatch(/font-display:\s*block/);
  expect(bundledFontCss).not.toMatch(/url\([^)]*(?:NotoSans|Cyrillic|Bengali|Devanagari)/);
});

test("the Arabic system language applies RTL and opens the panel with Right", async () => {
  await mountApp(PLAYLIST, { locale: "ar", resume: "a" });

  expect(document.documentElement.lang).toBe("ar");
  expect(document.documentElement.dir).toBe("rtl");
  expect(panelOpen()).toBe(false);
  expect(document.querySelector<HTMLElement>(".pb-number")?.textContent).toBe("1");

  press(KEY.RIGHT);

  expect(panelOpen()).toBe(true);

  press(KEY.YELLOW);

  expect(screen.getByRole("heading", { name: "المظهر" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "اللغة, العربية" })).toBeTruthy();
});

test("Swedish system language renders localized Retur key in KeyGuide", async () => {
  await mountApp(PLAYLIST, { locale: "sv", resume: "a" });

  expect(document.documentElement.lang).toBe("sv");
  const kbdElements = Array.from(document.querySelectorAll("kbd"));
  const returnKbd = kbdElements.find((el) => el.textContent === "Retur");
  expect(returnKbd).toBeTruthy();
  expect(kbdElements.some((el) => el.textContent === "Return")).toBe(false);
});
