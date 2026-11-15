import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { VodView } from "../src/components/VodView";
import { useVodBrowse } from "../src/stores/vodBrowse";
import { useLibrary } from "../src/stores/library";
import { KEY } from "../src/hooks/useRemote";
import { press } from "./support/app";
import { CatalogIndex } from "../src/services/catalogIndex";
import { scrollWindow } from "../src/hooks/useScrollWindow";
import { catalogController } from "../src/services/catalogCancellation";
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  useLibrary.getState().clear();
});
test.each([10000, 20000])(
  "%i movies keep grid/rail DOM bounded and final-item alphabet/remote focus reachable",
  async (count) => {
    const items = Array.from({ length: count }, (_, i) => ({
      kind: "movie" as const,
      key: `xtream:fixture:movie:${i}`,
      streamId: String(i),
      name: i === count - 1 ? "Z Last" : "A Movie",
      skey: i === count - 1 ? "z last" : "a movie",
      num: i,
      group: "Movies",
      categoryId: "1",
      rating: "",
      logo: "",
    }));
    const owner = new CatalogIndex("fixture", "movie", [{ id: "1", name: "Movies", count }]);
    for (let i = 0; i < count; i += 250) owner.add(items.slice(i, i + 250));
    await owner.finish(catalogController().signal);
    useLibrary.setState({
      catalogs: { movie: owner },
      vodItems: owner.items,
      vodGroups: owner.groups,
    });
    vi.spyOn(useLibrary.getState(), "loadVodCatalog").mockResolvedValue();
    const play = vi.fn();
    render(<VodView onPlayMovie={play} onOpenSeries={() => {}} onBack={() => {}} />);
    expect(document.querySelectorAll(".vod-tile").length).toBeLessThanOrEqual(30);
    fireEvent.click(
      [...document.querySelectorAll(".vod-az b")].find((el) => el.textContent === "Z")!,
    );
    expect(document.querySelector(".vod-tile.focused")?.getAttribute("data-media-key")).toBe(
      items[count - 1].key,
    );
    expect(document.querySelectorAll(".vod-tile").length).toBeLessThanOrEqual(30);
    press(KEY.ENTER);
    expect(play.mock.calls[0][0]).toBe(items[count - 1]);
    act(() => {
      for (let i = 0; i < 100; i++) press(KEY.UP);
    });
    expect(document.querySelector(".vod-tile.focused")).toBeTruthy();
  },
  20000,
);
test("window geometry bounds native scroll and clamps empty/final rows", () => {
  expect(scrollWindow(20000, 6, 372, 844, 1e9).end).toBe(20000);
  expect(scrollWindow(20000, 6, 372, 844, 0).end).toBeLessThanOrEqual(30);
  expect(scrollWindow(0, 6, 372, 844, 1e9)).toMatchObject({ start: 0, end: 0, height: 0 });
});
test("category cursor moves immediately but activation requires OK", async () => {
  vi.useFakeTimers();
  useLibrary.setState({
    catalogs: {},
    vodItems: [],
    vodGroups: [
      { id: "a", name: "A", count: 5 },
      { id: "b", name: "B", count: 5 },
    ],
  });
  vi.spyOn(useLibrary.getState(), "loadVodCatalog").mockResolvedValue();
  render(<VodView onPlayMovie={() => {}} onOpenSeries={() => {}} onBack={() => {}} />);
  press(KEY.LEFT);
  press(KEY.DOWN); // persistent Resume category
  press(KEY.DOWN); // persistent Favourites category
  press(KEY.DOWN);
  expect(document.querySelector(".vod-cat.focused")?.textContent).toContain("A");
  expect(useVodBrowse.getState().movie.selectedGroup).toBeNull();
  expect(useVodBrowse.getState().movie.favouritesOnly).toBe(false);
  press(KEY.DOWN);
  await act(() => vi.advanceTimersByTimeAsync(149));
  expect(useVodBrowse.getState().movie.selectedGroup).toBeNull();
  expect(useVodBrowse.getState().movie.favouritesOnly).toBe(false);
  await act(() => vi.advanceTimersByTimeAsync(1000));
  expect(useVodBrowse.getState().movie.selectedGroup).toBeNull();
  expect(useVodBrowse.getState().movie.favouritesOnly).toBe(false);
  press(KEY.ENTER);
  expect(document.querySelector(".vod-cat.active")?.textContent).toContain("B");
});

test("Left from a distant category reaches the toolbar and Down restores the rail cursor", async () => {
  vi.useFakeTimers();
  useLibrary.setState({
    catalogs: {},
    vodItems: [],
    vodGroups: Array.from({ length: 100 }, (_, i) => ({
      id: String(i),
      name: `Category ${i}`,
      count: 5,
    })),
  });
  const load = vi.spyOn(useLibrary.getState(), "loadVodCatalog").mockResolvedValue();
  render(<VodView onPlayMovie={() => {}} onOpenSeries={() => {}} onBack={() => {}} />);
  press(KEY.LEFT);
  for (let i = 0; i < 80; i++) press(KEY.DOWN);
  await act(() => vi.advanceTimersByTimeAsync(150));
  const category = document.querySelector(".vod-cat.focused")?.textContent;
  press(KEY.LEFT);
  expect(document.querySelector(".vod-tab.focused")?.textContent).toBe("Movies");
  press(KEY.DOWN);
  expect(document.querySelector(".vod-cat.focused")?.textContent).toBe(category);
  expect(load).toHaveBeenCalledTimes(1);
});
