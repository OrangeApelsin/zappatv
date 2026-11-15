import { mkdirSync, writeFileSync } from "node:fs";
import { act, cleanup } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { mountApp, settle } from "./support/app";
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.doUnmock("../src/stores/librarySelectors");
  vi.useRealTimers();
});
const playlist =
  '#EXTM3U\n#EXTINF:-1 tvg-id="a" group-title="News",Alpha\nhttp://example.invalid/a.m3u8';
test("a hundred background catalogue progress updates produce no picture-shell commits", async () => {
  const results: { mode: string; commits: number; durationMs: number; trace: number[] }[] = [];
  for (const mode of ["broad", "selected"]) {
    cleanup();
    localStorage.clear();
    if (mode === "broad")
      vi.doMock("../src/stores/librarySelectors", () => ({
        selectShellLibrary: (state: unknown) => state,
      }));
    else vi.doUnmock("../src/stores/librarySelectors");
    let trace: number[] = [];
    let commits = 0,
      durationMs = 0;
    await mountApp(playlist, {
      resume: "a",
      onRender: (_id, _phase, duration) => {
        commits++;
        durationMs += duration;
        trace.push(duration);
      },
    });
    await settle(1000);
    commits = 0;
    durationMs = 0;
    trace = [];
    const { useLibrary } = await import("../src/stores/library");
    for (let i = 1; i <= 100; i++)
      act(() => {
        const held = useLibrary.getState().catalogProgress;
        useLibrary.setState({
          catalogProgress: { ...held, movie: { ...held.movie, phasePercent: i } },
        });
      });
    results.push({ mode, commits, durationMs, trace });
  }
  expect(results[0].commits).toBeGreaterThanOrEqual(100);
  expect(results[1].commits).toBe(0);
  mkdirSync("build/audit", { recursive: true });
  writeFileSync(
    "build/audit/2101-app-render-trace.json",
    `${JSON.stringify(
      {
        simulation: true,
        hardwareTested: false,
        node: process.version,
        platform: process.platform,
        results,
      },
      null,
      2,
    )}\n`,
  );
});
