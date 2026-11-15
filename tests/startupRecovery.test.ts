import { readFileSync } from "node:fs";
import vm from "node:vm";
import { parse } from "acorn";
import { afterEach, expect, test, vi } from "vitest";

const source = readFileSync("public/startup.js", "utf8");
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
  document.documentElement.lang = "en";
});
function start(locale = "en", storageUnavailable = false) {
  vi.useFakeTimers();
  document.body.innerHTML = '<div id="root"><p>Static logo</p></div>';
  const handlers = new Map<string, (event: KeyboardEvent) => void>();
  const reload = vi.fn();
  const exit = vi.fn();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const windowStub = {
    setTimeout: (handler: () => void, delay: number) => {
      const timer = setTimeout(() => {
        timers.delete(timer);
        handler();
      }, delay);
      timers.add(timer);
      return timer;
    },
    clearTimeout: (timer: ReturnType<typeof setTimeout>) => {
      timers.delete(timer);
      clearTimeout(timer);
    },
    location: { reload },
    addEventListener: (name: string, handler: (event: KeyboardEvent) => void) =>
      handlers.set(name, handler),
    removeEventListener: (name: string) => handlers.delete(name),
    localStorage: {
      getItem: () => {
        if (storageUnavailable) throw new Error("disabled");
        return JSON.stringify({ locale });
      },
    },
    tizen: { application: { getCurrentApplication: () => ({ exit }) } },
  };
  vm.runInNewContext(source, { window: windowStub, document, Date });
  return { handlers, reload, exit, timers };
}

test("independent recovery script parses as ES5 and exposes a focused retry after a failed boot", () => {
  expect(() => parse(source, { ecmaVersion: 5, sourceType: "script" })).not.toThrow();
  const state = start();
  vi.advanceTimersByTime(14900);
  expect(document.getElementById("startup-recovery")).toBeNull();
  vi.advanceTimersByTime(100);
  const button = document.querySelector("button")!;
  expect(document.activeElement).toBe(button);
  state.handlers.get("keydown")!(
    new KeyboardEvent("keydown", { keyCode: 13, cancelable: true }),
  );
  expect(state.reload).toHaveBeenCalledOnce();
  state.handlers.get("keydown")!(
    new KeyboardEvent("keydown", { keyCode: 10009, cancelable: true }),
  );
  expect(state.exit).toHaveBeenCalledOnce();
  button.click();
  expect(state.reload).toHaveBeenCalledTimes(2);
});

test.each(["en", "sv", "ar"])(
  "recovery uses supported locale %s without storage writes",
  (locale) => {
    start(locale);
    vi.advanceTimersByTime(15000);
    expect(document.querySelector("#startup-recovery")?.getAttribute("dir")).toBe(
      locale === "ar" ? "rtl" : "ltr",
    );
    expect(document.querySelector("button")?.textContent).toBe(
      { en: "Retry", sv: "Försök igen", ar: "إعادة المحاولة" }[locale],
    );
  },
);

test("healthy or late React mount restores normal remote handling; blocked storage is tolerated", () => {
  const state = start("en", true);
  vi.advanceTimersByTime(15000);
  expect(document.querySelector("button")?.textContent).toBe("Retry");
  document.getElementById("root")!.innerHTML = '<div class="app"></div>';
  state.handlers.get("keydown")!(new KeyboardEvent("keydown", { keyCode: 13 }));
  expect(state.reload).not.toHaveBeenCalled();
  expect(state.handlers.size).toBe(0);
  expect(state.timers.size).toBe(0);
});

test("normal mount removes the watchdog before the failure deadline", () => {
  const state = start();
  document.getElementById("root")!.innerHTML = '<div class="app"></div>';
  vi.advanceTimersByTime(15000);
  expect(document.getElementById("startup-recovery")).toBeNull();
  expect(state.handlers.size).toBe(0);
  expect(state.timers.size).toBe(0);
});
