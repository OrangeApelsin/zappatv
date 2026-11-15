import { describe, expect, test } from "vitest";
import {
  directionFor,
  detectSystemLocale,
  formatNumber,
  LOCALE_OPTIONS,
  LOCALES,
  resolveLocale,
  translate,
  untranslatedKeys,
} from "../src/services/locale";

describe("locale selection", () => {
  test("uses the TV browser language for the System preference", () => {
    expect(resolveLocale("system", "ar-SA")).toBe("ar");
  });

  test("falls back to English for an unsupported system language", () => {
    expect(detectSystemLocale("de-DE")).toBe("en");
  });

  test("reads the browser language when System has no override", () => {
    const original = navigator.language;
    Object.defineProperty(navigator, "language", { configurable: true, value: "ar-SA" });
    try {
      expect(resolveLocale("system")).toBe("ar");
    } finally {
      Object.defineProperty(navigator, "language", { configurable: true, value: original });
    }
  });

  test("keeps an explicit locale when the system language differs", () => {
    expect(resolveLocale("sv", "en-GB")).toBe("sv");
  });

  test("marks Arabic as right to left", () => {
    expect(directionFor("ar")).toBe("rtl");
  });

  test("marks Swedish and English as left to right", () => {
    expect(directionFor("sv")).toBe("ltr");
    expect(directionFor("en")).toBe("ltr");
  });

  test("detects Swedish system language", () => {
    expect(resolveLocale("system", "sv-SE")).toBe("sv");
  });

  test("translates a message with a count", () => {
    expect(translate("sv", "playlist.loadedActive", { count: 2 })).toContain("2");
  });

  test("translates Swedish catalog at runtime", () => {
    expect(translate("sv", "settings.title")).toBe("Inställningar");
    expect(translate("sv", "common.search")).toBe("Sök");
    expect(translate("sv", "common.returnKey")).toBe("Retur");
    expect(translate("sv", "common.return")).toBe("Retur");
    expect(translate("en", "common.returnKey")).toBe("Return");
  });

  test("formats generated numbers with the selected locale", () => {
    expect(formatNumber("sv", 1234)).toBe(new Intl.NumberFormat("sv").format(1234));
  });

  test("ships a translation for every interface message in every locale", () => {
    for (const locale of LOCALES) expect(untranslatedKeys(locale)).toEqual([]);
  });

  test("offers Arabic, English, and Swedish sorted by English name", () => {
    const languages = LOCALE_OPTIONS.filter((option) => option.id !== "system");
    expect(languages).toHaveLength(3);
    expect(LOCALE_OPTIONS[0].id).toBe("system");
    const names = languages.map((option) => option.englishName);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });
});
