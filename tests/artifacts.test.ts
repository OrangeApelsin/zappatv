import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { checkArtifacts } from "../scripts/check-artifacts.mjs";

const directories: string[] = [];
afterEach(() => {
  for (const root of directories.splice(0)) rmSync(root, { recursive: true, force: true });
});
function artifact(
  entry = '(function(){new Worker(new URL("worker.js", import.meta.url),{type:"module"});})();',
) {
  const root = mkdtempSync(join(tmpdir(), "zappa-artifact-"));
  directories.push(root);
  mkdirSync(join(root, "assets"));
  writeFileSync(join(root, "index.html"), '<script defer src="./assets/main.js"></script>');
  writeFileSync(join(root, "assets/main.js"), entry);
  writeFileSync(
    join(root, "assets/vodWorker-fixture.js"),
    "(function(){self.postMessage({ready:true});})();",
  );
  return root;
}

test("the emitted classic entry cannot retain the original import.meta regression", () => {
  expect(() => checkArtifacts({ root: artifact(), target: "5.0" })).toThrow(
    "classic syntax failed",
  );
  expect(() => checkArtifacts({ root: artifact("export {x};"), target: "5.5" })).toThrow(
    "classic syntax failed",
  );
});

test("the development simulation cannot enter production widget scripts", () => {
  expect(() => checkArtifacts({ root: artifact("window.__ZAPPA_TV_PREVIEW__ = {};") })).toThrow(
    "preview simulation",
  );
});

test.each(["3.0", "4.0", "5.0", "5.5"])(
  "classic entry and worker produce hash evidence for %s",
  (target) => {
    const result = checkArtifacts({
      root: artifact("(function(){window.mounted=true;})();"),
      target,
    });
    expect(result.scripts).toHaveLength(2);
    expect(
      result.scripts.every((script: { sha256: string }) =>
        /^[a-f0-9]{64}$/.test(script.sha256),
      ),
    ).toBe(true);
  },
);

test("target-era grammar applies independently to the worker", () => {
  const root = artifact("(function(){})();");
  writeFileSync(join(root, "assets/vodWorker-fixture.js"), "try {} catch {}");
  expect(() => checkArtifacts({ root, target: "5.0" })).toThrow("vodWorker-fixture.js");
  expect(checkArtifacts({ root, target: "5.5" }).scripts).toHaveLength(2);
});

test("module startup, remote or escaping scripts and missing worker fail closed", () => {
  const root = artifact("(function(){})();");
  for (const html of [
    '<script type="module" src="./assets/main.js"></script>',
    '<script src="https://example.invalid/app.js"></script>',
    '<script src="../outside.js"></script>',
  ]) {
    writeFileSync(join(root, "index.html"), html);
    expect(() => checkArtifacts({ root })).toThrow();
  }
  writeFileSync(join(root, "index.html"), '<script src="./assets/main.js"></script>');
  rmSync(join(root, "assets/vodWorker-fixture.js"));
  expect(() => checkArtifacts({ root })).toThrow("exactly one");
});

test("only the exact Samsung system loader is exempt from packaged-file checks", () => {
  const root = artifact("(function(){})();");
  const entry = '<script src="./assets/main.js"></script>';
  const loader = '<script src="$WEBAPIS/webapis/webapis.js"></script>';
  writeFileSync(join(root, "index.html"), loader + entry);
  expect(checkArtifacts({ root }).platformScripts).toEqual(["$WEBAPIS/webapis/webapis.js"]);
  writeFileSync(join(root, "index.html"), loader + loader + entry);
  expect(() => checkArtifacts({ root })).toThrow("Duplicate");
  for (const suffix of ["?url=https://evil.test", "/../evil.js"]) {
    writeFileSync(join(root, "index.html"), `<script src="$WEBAPIS/webapis/webapis.js${suffix}"></script>${entry}`);
    expect(() => checkArtifacts({ root })).toThrow();
  }
});
