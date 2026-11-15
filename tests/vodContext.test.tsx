import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { KEY } from "../src/hooks/useRemote";
import {
  mountApp,
  muteChanges,
  playCalls,
  played,
  playerLifecycle,
  press,
  setPlaybackTime,
  settle,
  XTREAM_SOURCE,
} from "./support/app";
import { vodProvider } from "./support/vodProvider";

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function mount(grid = true, flags: Parameters<typeof vodProvider>[0] = {}) {
  localStorage.setItem("zappa.viewMode", grid ? "grid" : "panel");
  const provider = vodProvider(flags);
  const view = await mountApp("", { source: XTREAM_SOURCE, fetchImplementation: provider });
  return { view, provider };
}
async function content(name: "Movies" | "Series") {
  fireEvent.click(screen.getAllByRole("button", { name }).at(-1)!);
  await settle(100);
}
async function gridTool(label: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>("#view-vod .vod-tab")].find(
    (el) => (el.querySelector(".vod-tool-label")?.textContent ?? el.textContent) === label,
  );
  expect(button).toBeTruthy();
  fireEvent.click(button!);
  await settle(100);
}
async function row(label: string) {
  const tile = [...document.querySelectorAll<HTMLButtonElement>(".vod-tile")].find(
    (item) => item.getAttribute("aria-label") === label,
  );
  if (tile) {
    fireEvent.click(tile);
    await settle(100);
    return;
  }
  const target = screen.getAllByText(label).find((el) => el.closest("button"));
  expect(target).toBeTruthy();
  fireEvent.click(target!.closest("button")!);
  await settle(100);
}
test("grid movie details/Back and modal close restore item and trigger focus; Yellow sorts without Settings", async () => {
  await mount();
  await content("Movies");
  await row("Film B");
  expect(document.querySelector("#view-vod-details")).toBeTruthy();
  press(KEY.BACK);
  await settle(100);
  expect(document.querySelector(".vod-tile.focused")?.getAttribute("aria-label")).toBe(
    "Film B",
  );
  press(KEY.YELLOW);
  expect(document.querySelector(".sheet")).toBeNull();
  expect(document.querySelector(".vod-meta")?.textContent).toContain("Year");
  await gridTool("Settings");
  press(KEY.BACK);
  await settle(100);
  expect(document.querySelector("#view-vod .vod-tab.focused")?.textContent).toBe("Settings");
});

test("movie modal retains the grid and playback, contains focus and restores the same trigger", async () => {
  await mount();
  await content("Movies");
  const grid = document.querySelector("#view-vod");
  const starts = played.length;
  await row("Film B");
  const dialog = screen.getByRole("dialog", { name: "Film B" });
  expect(document.querySelector("#view-vod")).toBe(grid);
  expect(grid?.getAttribute("aria-hidden")).toBe("true");
  expect(dialog.contains(document.activeElement)).toBe(true);
  for (let index = 0; index < 8; index++) {
    press(9);
    expect(dialog.contains(document.activeElement)).toBe(true);
  }
  press(KEY.GREEN);
  await settle(200);
  expect(dialog.contains(document.activeElement)).toBe(true);
  expect(screen.getByRole("button", { name: /^Remove favourite/ })).toBeTruthy();
  expect(played).toHaveLength(starts);
  press(KEY.BACK);
  await settle(100);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.querySelector("#view-vod")).toBe(grid);
  expect(document.activeElement?.getAttribute("aria-label")).toBe("Film B");
});
test("controlled tabs stay synchronized and series/Back restores the selected grid item", async () => {
  await mount();
  await content("Movies");
  await gridTool("Series");
  await row("Show B");
  expect(document.querySelector("#view-series")).toBeTruthy();
  press(KEY.DOWN);
  press(KEY.BACK);
  await settle(100);
  expect(document.querySelector(".vod-tile.focused")?.getAttribute("aria-label")).toBe(
    "Show B",
  );
  expect(document.querySelector(".vod-tab.active")?.textContent).toBe("Series");
});
test("switching list/grid restores category and canonical movie selection without a second download", async () => {
  const { provider } = await mount();
  await content("Movies");
  await row("Film C");
  press(KEY.BACK);
  await settle(100);
  await gridTool("List view");
  expect(document.querySelector("#view-vod")).toBeNull();
  expect(document.querySelector(".media-list .row.selected")?.textContent).toContain("Film C");
  fireEvent.click(screen.getByRole("button", { name: "Poster grid" }));
  await settle(100);
  expect(document.querySelector(".vod-tile.focused")?.getAttribute("aria-label")).toBe(
    "Film C",
  );
  expect(
    provider.mock.calls.filter(
      ([url]) => new URL(String(url)).searchParams.get("action") === "get_vod_streams",
    ),
  ).toHaveLength(1);
});
test("episode hub switches layouts on the same season/episode and restores it after playback browsing", async () => {
  await mount();
  await content("Series");
  await row("Show B");
  press(KEY.DOWN);
  const before = document.querySelector(".sr-ep.focused")?.getAttribute("data-episode-key");
  expect(before).toContain(":episode:202");
  fireEvent.click(screen.getByRole("button", { name: "List view" }));
  await settle(100);
  expect(document.querySelector(".media-list .row.selected")?.textContent).toContain("Second");
  fireEvent.click(screen.getByRole("button", { name: "Poster grid" }));
  await settle(100);
  expect(document.querySelector(".sr-ep.focused")?.getAttribute("data-episode-key")).toBe(
    before,
  );
  press(KEY.ENTER);
  await settle(100);
  expect(played.at(-1)).toContain("/series/viewer/secret/202.mp4");
  await settle(10000);
  const starts = played.length;
  press(KEY.BACK);
  await settle(100);
  expect(played).toHaveLength(starts);
  expect(document.querySelector(".sr-ep.focused")?.getAttribute("data-episode-key")).toBe(
    before,
  );
});
test("search Return closes editing then restores browsing; the session query survives reopening", async () => {
  await mount(false);
  await content("Movies");
  await row("Cinema");
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  await settle(100);
  const field = screen.getByRole("textbox", { name: "Search movies or series by name" });
  fireEvent.keyDown(field, { keyCode: KEY.ENTER });
  fireEvent.change(field, { target: { value: "Film B" } });
  await settle(200);
  fireEvent.keyDown(field, { keyCode: KEY.BACK });
  expect((field as HTMLInputElement).readOnly).toBe(true);
  press(KEY.BACK);
  await settle(100);
  expect(screen.queryByRole("textbox")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  await settle(100);
  expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("Film B");
});
test("grid failure has remote Retry, and a failed refresh retains usable items with stale guidance", async () => {
  const flags = { failMovies: true };
  await mount(true, flags);
  await content("Movies");
  expect(screen.getByText("This content could not be loaded.")).toBeTruthy();
  flags.failMovies = false;
  press(KEY.ENTER);
  await settle(150);
  expect(document.querySelectorAll(".vod-tile")).toHaveLength(3);
  const { useLibrary } = await import("../src/stores/library");
  flags.failMovies = true;
  await act(async () => {
    const task = useLibrary.getState().loadVodCatalog("movie", true);
    await vi.advanceTimersByTimeAsync(100);
    await task;
  });
  expect(screen.getByText("Showing saved items. Refresh failed.")).toBeTruthy();
  expect(document.querySelectorAll(".vod-tile")).toHaveLength(3);
});
test("a stopped movie leaves the home Live TV card on the previously watched channel", async () => {
  await mount(false);
  await row("TV4");
  await settle(500);
  press(KEY.BACK);
  await settle(100); // hide banner
  press(KEY.BACK);
  await settle(100); // home
  fireEvent.click(screen.getByRole("button", { name: "Movies" }));
  await settle(100);
  await row("Cinema");
  await row("Film A");
  fireEvent.click(screen.getByRole("button", { name: "Play" }));
  await settle(100);
  setPlaybackTime(30, 100);
  await settle(10000);
  press(KEY.BACK);
  await settle(100);
  expect(
    document.querySelector("#view-vod .vod-tile.focused")?.getAttribute("aria-label"),
  ).toBe("Film A");
  press(KEY.BACK);
  await settle(100);
  expect(document.querySelector("#view-home .home-tile-channel")?.textContent).toContain("TV4");
  fireEvent.click(document.querySelector("#view-home .tile-tv")!);
  await settle(500);
  expect(played.at(-1)).toContain("/4.m3u8");
});

test("Home VOD entry forces the grid despite a saved list preference", async () => {
  await mount(false);
  await row("TV4");
  await settle(500);
  press(KEY.BACK);
  press(KEY.BACK);
  await settle(100);
  fireEvent.click(screen.getByRole("button", { name: "Movies" }));
  await settle(200);
  expect(document.querySelector("#view-vod")).toBeTruthy();
  await gridTool("List view");
  expect(document.querySelector("#view-vod")).toBeNull();
});
test("fullscreen TV Left always opens the regular channel panel after a grid preference", async () => {
  await mount(true);
  await row("TV4");
  await settle(500);
  const starts = played.length;
  press(KEY.LEFT);
  await settle(200);
  expect(document.querySelector("#view-vod")).toBeNull();
  expect(document.querySelector(".home-grid")).toBeNull();
  expect(document.querySelector(".list .row.selected")?.textContent).toContain("TV4");
  expect(played).toHaveLength(starts);
});

test("Settings keeps the live player session and exposes a playback backdrop", async () => {
  await mount(false);
  await row("TV4");
  await settle(500);
  const starts = played.length,
    events = playerLifecycle.length,
    muteCommands = muteChanges.length;
  press(KEY.YELLOW);
  await settle(100);
  expect(document.querySelector(".sheet.over-playback")).toBeTruthy();
  await settle(5000);
  expect(played).toHaveLength(starts);
  expect(playerLifecycle).toHaveLength(events);
  expect(muteChanges).toHaveLength(muteCommands);
  press(KEY.BACK);
  await settle(100);
  expect(played).toHaveLength(starts);
  expect(playerLifecycle).toHaveLength(events);
  expect(muteChanges).toHaveLength(muteCommands);
});

test("grid search debounces, restores the movie and reopens with a fresh query", async () => {
  const { provider } = await mount();
  await content("Movies");
  await row("Film C");
  press(KEY.BACK);
  await settle(100);
  const starts = played.length;
  await gridTool("Search");
  const field = screen.getByRole("textbox", {
    name: "Search movies or series by name",
  }) as HTMLInputElement;
  expect(document.querySelector("#view-vod")).toBeTruthy();
  expect(field.closest(".search")?.className).toContain("focused");
  press(KEY.ENTER);
  expect(field.readOnly).toBe(false);
  fireEvent.change(field, { target: { value: "Film B" } });
  await settle(149);
  expect(document.querySelectorAll(".vod-tile")).toHaveLength(3);
  await settle(1);
  expect(document.querySelectorAll(".vod-tile")).toHaveLength(1);
  expect(document.querySelector(".vod-tile")?.getAttribute("aria-label")).toBe("Film B");
  press(KEY.BACK);
  expect(field.readOnly).toBe(true);
  press(KEY.BACK);
  await settle(200);
  expect(document.querySelector("#view-vod input")).toBeNull();
  expect(document.querySelector(".vod-title")?.textContent).toBe("Film C");
  await gridTool("Search");
  expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("");
  expect(played).toHaveLength(starts);
  expect(
    provider.mock.calls.filter(
      ([url]) => new URL(String(url)).searchParams.get("action") === "get_vod_streams",
    ),
  ).toHaveLength(1);
});

test.each(["Movies", "Series"] as const)(
  "%s grid favourites persist at zero and Green toggles from the grid",
  async (kind) => {
    await mount();
    await content(kind);
    const category = (label: string) =>
      [...document.querySelectorAll<HTMLButtonElement>(".vod-cat")].find(
        (button) => button.querySelector(".vod-cat-name")?.textContent === label,
      )!;
    fireEvent.click(category("Favourites"));
    await settle(100);
    expect(document.querySelectorAll(".vod-tile")).toHaveLength(0);
    expect(screen.getByText(/No favourites yet/)).toBeTruthy();
    expect(category("Favourites").querySelector(".vod-cat-count")?.textContent).toBe("0");
    fireEvent.click(category(kind === "Movies" ? "All Movies" : "All Series"));
    await settle(100);
    press(KEY.GREEN);
    await settle(100);
    expect(document.querySelectorAll(".vod-favourite")).toHaveLength(1);
    fireEvent.click(category("Favourites"));
    await settle(100);
    expect(document.querySelectorAll(".vod-tile")).toHaveLength(1);
    press(KEY.GREEN);
    await settle(100);
    expect(document.querySelectorAll(".vod-tile")).toHaveLength(0);
    expect(category("Favourites").classList.contains("active")).toBe(true);
    expect(category("Favourites").querySelector(".vod-cat-count")?.textContent).toBe("0");
  },
);

test.each(["Movies", "Series"] as const)(
  "%s grid includes Resume group listing items with active progress",
  async (kind) => {
    await mount();
    const { usePersonal } = await import("../src/stores/personal");

    await content(kind);
    const category = (label: string) =>
      [...document.querySelectorAll<HTMLButtonElement>(".vod-cat")].find(
        (button) => button.querySelector(".vod-cat-name")?.textContent === label,
      )!;

    // Check that Resume group exists alongside All and Favourites
    expect(category("Resume")).toBeTruthy();
    expect(category("Resume").querySelector(".vod-cat-count")?.textContent).toBe("0");

    // Add progress to an item in kind
    const itemKey = kind === "Movies" ? "v100" : "s200";

    act(() => {
      usePersonal.getState().rememberProgress(itemKey, 120, 3600, true);
    });
    await settle(100);

    // Resume count updates
    expect(category("Resume").querySelector(".vod-cat-count")?.textContent).toBe("1");

    // Click Resume category
    fireEvent.click(category("Resume"));
    await settle(100);
    expect(category("Resume").classList.contains("active")).toBe(true);
    expect(document.querySelector(".vod-headline")?.textContent).toContain("Resume");
    expect(document.querySelectorAll(".vod-tile")).toHaveLength(1);
  },
);

test("one Back returns a Home-opened movie grid to Home without retuning", async () => {
  await mount();
  for (let i = 0; i < 4 && !document.querySelector(".tile-movies"); i++) {
    press(KEY.BACK);
    await settle(100);
  }
  expect(document.querySelector(".tile-movies")).toBeTruthy();
  fireEvent.click(document.querySelector(".tile-movies")!);
  await settle(500);
  expect(document.querySelector("#view-vod")).toBeTruthy();
  const starts = played.length;
  press(KEY.BACK);
  await settle(100);
  expect(document.querySelector("#view-vod")).toBeNull();
  expect(document.querySelector(".tile-movies")).toBeTruthy();
  expect(played).toHaveLength(starts);
});

test("crossing toolbar kinds keeps Movies active; explicit switching hides and discards search", async () => {
  await mount();
  await content("Movies");
  await gridTool("Movies");
  press(KEY.RIGHT);
  press(KEY.RIGHT);
  press(KEY.RIGHT);
  await settle(100);
  expect(document.querySelector(".vod-tab.active")?.textContent).toBe("Movies");
  press(KEY.ENTER);
  await settle(100);
  const field = screen.getByRole("textbox") as HTMLInputElement;
  fireEvent.change(field, { target: { value: "Film B" } });
  await settle(200);
  await gridTool("Series");
  expect(document.querySelector("#view-vod input")).toBeNull();
  await gridTool("Movies");
  expect(document.querySelector("#view-vod input")).toBeNull();
  await gridTool("Search");
  expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("");
});

test("the grid favourite hint stays concise without repeating the focused title (TICKET-2168)", async () => {
  await mount();
  await content("Movies");
  await row("Film B");
  press(KEY.BACK);
  await settle(100);
  const hint = document.querySelector(".vod-favourite-hint");
  expect(hint?.textContent).toContain("Add favourite");
  expect(hint?.textContent).not.toContain("Film B");
  expect(hint?.querySelector("button, [tabindex]")).toBeNull();
  expect(hint?.querySelector(".remote-color-green")?.getAttribute("aria-label")).toBe(
    "Green button",
  );
  press(KEY.GREEN);
  await settle(100);
  expect(hint?.textContent).toContain("Remove favourite");
  expect(hint?.textContent).not.toContain("Film B");
});

test("an alphabet jump restores name order after an explicit alternative sort", async () => {
  await mount();
  await content("Movies");
  expect(
    [...document.querySelectorAll(".vod-tile")].map((item) => item.getAttribute("aria-label")),
  ).toEqual(["Film A", "Film B", "Film C"]);
  press(KEY.YELLOW);
  expect(document.querySelector(".vod-meta")?.textContent).toContain("Year");
  const letter = [...document.querySelectorAll(".vod-az b")].find(
    (item) => item.textContent === "F",
  );
  fireEvent.click(letter!);
  await settle(100);
  expect(document.querySelector(".vod-meta")?.textContent).toContain("Name");
  expect(document.querySelector(".vod-tile.focused")?.getAttribute("aria-label")).toBe(
    "Film A",
  );
});

test("VOD OSD Settings keeps the decoder, audio and playback position alive", async () => {
  await mount();
  await content("Movies");
  await row("Film B");
  fireEvent.click(screen.getByRole("button", { name: "Play" }));
  await settle(100);
  const starts = played.length,
    lifecycle = playerLifecycle.length,
    mutes = muteChanges.length;
  press(KEY.UP);
  await settle(100);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  await settle(500);
  expect(document.querySelector(".sheet.over-playback")).toBeTruthy();
  expect(played).toHaveLength(starts);
  expect(playerLifecycle).toHaveLength(lifecycle);
  expect(muteChanges).toHaveLength(mutes);
  press(KEY.BACK);
  await settle(100);
  expect(document.querySelector(".sheet")).toBeNull();
  expect(played).toHaveLength(starts);
});

test("movie details modal shows both Resume and Play from beginning when progress exists, and restarts from 0", async () => {
  await mount();
  const { useLibrary } = await import("../src/stores/library");
  const { usePersonal } = await import("../src/stores/personal");

  await content("Movies");
  await row("Film B");
  await settle(200);

  const movieKey =
    Object.keys(useLibrary.getState().movieDetails)[0] ??
    "xtream:pl-1:v1:bd0fbb1ceed6f74ca27d9848db91f1c8:movie:101";
  act(() => {
    usePersonal.getState().rememberProgress(movieKey, 125, 3600, true);
  });
  await settle(100);

  const resumeBtn = screen.getByRole("button", { name: /^Resume/ });
  const restartBtn = screen.getByRole("button", { name: "Play from beginning" });
  expect(resumeBtn).toBeTruthy();
  expect(restartBtn).toBeTruthy();

  // Spatial navigation moves between Resume and Play from beginning
  press(KEY.DOWN);
  await settle(50);
  expect(document.activeElement).toBe(restartBtn);

  // Clicking restart button plays without resumeAt
  fireEvent.click(restartBtn);
  await settle(100);
  expect(played).toHaveLength(1);
  const lastPlayCall = playCalls.at(-1);
  expect(lastPlayCall?.[3]).toBeUndefined();
});

test("episode with resume point displays progress indicator and selecting it opens Resume / Play from beginning modal", async () => {
  await mount();
  const { usePersonal } = await import("../src/stores/personal");

  await content("Series");
  await row("Show B");
  expect(document.querySelector("#view-series")).toBeTruthy();

  press(KEY.DOWN);
  await settle(50);
  const epBtn = document.querySelector(".sr-ep.focused");
  expect(epBtn).toBeTruthy();
  const epKey = epBtn?.getAttribute("data-episode-key") ?? "";
  expect(epKey).toBeTruthy();

  // Initially no resume indicator
  expect(epBtn?.querySelector(".episode-progress")).toBeNull();

  // Set progress for episode
  act(() => {
    usePersonal.getState().rememberProgress(epKey, 240, 1800, true);
  });
  await settle(100);

  // Resume progress badge now visible
  const progressBadge = document.querySelector(`[data-progress-key="${epKey}"]`);
  expect(progressBadge).toBeTruthy();
  expect(progressBadge?.textContent).toContain("Resume 4:00");

  // Pressing ENTER on episode with resume points opens prompt modal instead of immediate playback
  const starts = played.length;
  press(KEY.ENTER);
  await settle(50);
  expect(played).toHaveLength(starts);

  const modal = document.querySelector("#view-episode-details");
  expect(modal).toBeTruthy();
  expect(modal?.getAttribute("role")).toBe("dialog");

  const resumeBtn = screen.getByRole("button", { name: /^Resume 4:00/ });
  const restartBtn = screen.getByRole("button", { name: "Play from beginning" });
  expect(resumeBtn).toBeTruthy();
  expect(restartBtn).toBeTruthy();

  // Down moves focus to "Play from beginning"
  press(KEY.DOWN);
  await settle(50);
  expect(restartBtn.classList.contains("focused")).toBe(true);

  // Enter triggers play with restart (position 0)
  press(KEY.ENTER);
  await settle(100);
  expect(document.querySelector("#view-episode-details")).toBeNull();
  expect(played).toHaveLength(starts + 1);
  const lastPlay = playCalls.at(-1);
  expect(lastPlay?.[3]).toBeUndefined();
});

test("empty groups in movies, series, and live TV are automatically hidden from category rails", async () => {
  const { useLibrary } = await import("../src/stores/library");
  useLibrary.setState({
    vodGroups: [
      { id: "active-movies", name: "Active Movies", count: 12 },
      { id: "empty-movies", name: "Empty Movies", count: 0 },
    ],
    seriesGroups: [
      { id: "active-series", name: "Active Series", count: 5 },
      { id: "empty-series", name: "Empty Series", count: 0 },
    ],
  });

  const { render } = await import("@testing-library/react");
  const { VodView } = await import("../src/components/VodView");

  const { unmount } = render(
    <VodView kind="movie" onPlayMovie={() => {}} onOpenSeries={() => {}} onBack={() => {}} />,
  );

  const renderedCats = Array.from(document.querySelectorAll(".vod-cat")).map(
    (el) => el.textContent ?? "",
  );
  expect(renderedCats.some((c) => c.includes("Active Movies"))).toBe(true);
  expect(renderedCats.some((c) => c.includes("Empty Movies"))).toBe(false);

  unmount();
});
