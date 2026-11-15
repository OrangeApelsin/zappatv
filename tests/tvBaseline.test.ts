import { afterEach, expect, test } from "vitest";
import { catalogFixture } from "../scripts/tv/catalog-fixture.mjs";
import { LAUNCH_MARKS } from "../scripts/tv/launch-marks.mjs";

afterEach(() => {
  document.body.innerHTML = "";
});

test("the static logo cannot satisfy the React mount measurement", () => {
  document.body.innerHTML =
    '<div id="root"><div><img src="./icon.svg"><p>Zappa TV</p></div></div>';
  // The inherited predicate incorrectly passed even if the entire entry failed to parse.
  expect(document.querySelector("#root *") !== null).toBe(true);
  const mounted = () => new Function(`return ${LAUNCH_MARKS["the interface"]}`)();
  expect(mounted()).toBe(false);
  document.getElementById("root")!.innerHTML = '<div class="app"></div>';
  expect(mounted()).toBe(true);
});

test.each([10_000, 20_000])(
  "large fixture retains final records, source collisions and long seasons (%i)",
  (count) => {
    const fixture = catalogFixture({ count });
    expect(fixture.movies).toHaveLength(count);
    expect(fixture.series).toHaveLength(count);
    expect(fixture.movies.at(-1)?.stream_id).toBe(count);
    expect(fixture.movies.at(-1)?.name).toContain("FINAL");
    expect(fixture.series.at(-1)?.series_id).toBe(count);
    expect(fixture.seriesInfo.episodes["1"]).toHaveLength(1000);
    expect(fixture.seriesInfo.episodes["1"].at(-1)?.title).toContain("FINAL");
    expect(fixture.seriesInfo.episodes["2"][0].id).toBe(1001);
    const other = catalogFixture({ count, source: "b" });
    expect(other.movies[0].stream_id).toBe(fixture.movies[0].stream_id);
    expect(other.source).not.toBe(fixture.source);
    expect(other.movies[0].name).not.toBe(fixture.movies[0].name);
  },
);
