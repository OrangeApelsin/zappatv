// @vitest-environment node
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { checkWidget } from "../scripts/check-widget.mjs";
import { createZip } from "../scripts/package-wgt.mjs";
import {
  floorPlatform,
  packageTargets,
  targetPolicy,
  widgetName,
} from "../scripts/tv/platforms.mjs";

const owned: string[] = [];
afterEach(() => {
  for (const dir of owned.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function fixture(target = "5.0") {
  const root = mkdtempSync(join(tmpdir(), "zappa-widget-gate-"));
  owned.push(root);
  mkdirSync(join(root, "assets"));
  writeFileSync(join(root, "index.html"), '<script src="./assets/main.js"></script>');
  writeFileSync(join(root, "assets/main.js"), "(function(){})();");
  writeFileSync(join(root, "assets/vodWorker-fixture.js"), "self.postMessage({ready:true});");
  writeFileSync(
    join(root, "config.xml"),
    `<widget xmlns="http://www.w3.org/ns/widgets" xmlns:t="http://tizen.org/ns/widgets" id="http://zappa.local/ZappaTV" version="2.4.0"><t:application id="ZappaTV002.ZappaTV" package="ZappaTV002" required_version="${target}"/><content src="index.html"/></widget>`,
  );
  const policy = targetPolicy(target);
  writeFileSync(
    join(root, "build-target.json"),
    JSON.stringify({
      target,
      chromium: policy.chromium,
      experimental: policy.package.experimental,
      version: "2.4.0",
    }),
  );
  return root;
}

test("one policy sets the priority floor, experimental status, grammar and filenames", () => {
  expect(floorPlatform().chromium).toBe(63);
  expect(
    packageTargets
      .filter((tv: { package: { experimental: boolean } }) => tv.package.experimental)
      .map((tv: { tizen: string }) => tv.tizen),
  ).toEqual(["3.0", "4.0"]);
  expect(widgetName("2.5.0", "5.0")).toBe("zappa-2.5.0-tizen5.wgt");
  expect(() => targetPolicy("5.1")).toThrow("Unknown");
});

test.each(["3.0", "4.0", "5.0", "5.5"])(
  "extracted %s manifest, compiled target and classic scripts agree",
  (target) => {
    const result = checkWidget({ root: fixture(target), target, version: "2.4.0" });
    expect(result.experimental).toBe(Number(target) < 5);
    expect(result.scripts).toHaveLength(2);
  },
);

test("a manifest stamp cannot disguise a different compiled target or changed app identity", () => {
  const root = fixture();
  writeFileSync(join(root, "build-target.json"), JSON.stringify({ target: "5.5" }));
  expect(() => checkWidget({ root, target: "5.0", version: "2.4.0" })).toThrow("Built target");
  const other = fixture();
  const manifest = join(other, "config.xml");
  writeFileSync(
    manifest,
    readFileSync(manifest, "utf8").replace("ZappaTV002.ZappaTV", "Another.App"),
  );
  expect(() => checkWidget({ root: other, target: "5.0", version: "2.4.0" })).toThrow(
    "identity",
  );
});

test("widget extraction checks CRCs and refuses traversal, duplicate paths and reused destinations", () => {
  const root = fixture();
  const zip = join(root, "input.wgt");
  const python = process.platform === "win32" ? "python" : "python3";
  const extract = (destination: string) =>
    execFileSync(python, ["scripts/extract-widget.py", zip, destination], { stdio: "pipe" });
  for (const names of [
    ["../escaped.txt"],
    ["C:/escaped.txt"],
    ["a.txt", "A.txt"],
    ["a/b.txt", "a/./b.txt"],
  ]) {
    writeFileSync(
      zip,
      createZip(names.map((name) => ({ name, data: Buffer.from("fixture") }))),
    );
    expect(() => extract(join(root, "extracted"))).toThrow();
  }
  const valid = createZip([{ name: "a.txt", data: Buffer.from("fixture") }]);
  const corrupt = Buffer.from(valid);
  corrupt[35] ^= 1;
  writeFileSync(zip, corrupt);
  expect(() => extract(join(root, "corrupt"))).toThrow();
  writeFileSync(zip, valid);
  extract(join(root, "extracted"));
  expect(readFileSync(join(root, "extracted/a.txt"), "utf8")).toBe("fixture");
  expect(() => extract(join(root, "extracted"))).toThrow();
});
