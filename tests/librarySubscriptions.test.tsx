import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { useShallow } from "zustand/react/shallow";
import { useLibrary } from "../src/stores/library";
import { selectShellLibrary } from "../src/stores/librarySelectors";
afterEach(cleanup);

test("catalogue progress rerenders its consumer but not the shell subscription", () => {
  const counts = { broad: 0, shell: 0, stage: 0 };
  function Broad() {
    useLibrary();
    counts.broad++;
    return null;
  }
  function Shell() {
    useLibrary(useShallow(selectShellLibrary));
    counts.shell++;
    return null;
  }
  function Stage() {
    useLibrary((s) => s.catalogProgress.movie.phasePercent);
    counts.stage++;
    return null;
  }
  const held = useLibrary.getState();
  render(
    <>
      <Broad />
      <Shell />
      <Stage />
    </>,
  );
  const before = { ...counts };
  for (let i = 1; i <= 100; i++)
    act(() =>
      useLibrary.setState({
        catalogProgress: {
          ...held.catalogProgress,
          movie: { ...held.catalogProgress.movie, phasePercent: i },
        },
      }),
    );
  expect(counts.broad - before.broad).toBe(100);
  expect(counts.shell - before.shell).toBe(0);
  expect(counts.stage - before.stage).toBe(100);
  act(() => useLibrary.setState({ categories: { ...held.categories } }));
  expect(counts.shell - before.shell).toBe(1);
  useLibrary.setState({ catalogProgress: held.catalogProgress, categories: held.categories });
});
