import { afterEach, expect, test, vi } from "vitest";
import { openFixtureMovies } from "../scripts/tv/startup-journey.mjs";

afterEach(() => {
  document.body.innerHTML = "";
});

test("a painted home shell without a spinner is not yet a loaded source", () => {
  document.body.innerHTML = '<button class="tile-movies">Movies</button>';
  const click = vi.fn();
  document.querySelector("button")!.addEventListener("click", click);
  expect(openFixtureMovies()).toBe(false);
  expect(click).not.toHaveBeenCalled();
  document.body.insertAdjacentHTML(
    "beforeend",
    '<div class="home-tile-channel">Live Channel 0001</div>',
  );
  expect(openFixtureMovies()).toBe(true);
  expect(click).toHaveBeenCalledTimes(1);
});

test("loading and absent home screens cannot consume the navigation attempt", () => {
  document.body.innerHTML =
    '<button class="tile-movies">Movies</button><div class="home-tile-channel">Channel</div><div class="splash"><div class="spinner"></div></div>';
  expect(openFixtureMovies()).toBe(false);
  document.body.innerHTML = '<div class="home-tile-channel">Channel</div>';
  expect(openFixtureMovies()).toBe(false);
});
