// @vitest-environment node
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, test } from "vitest";
import { packageWidget, collectFiles, createZip } from "../scripts/package-wgt.mjs";
import { signWidget, verifySignedWidget } from "../scripts/device-widget.mjs";
import { packageVersion, stampVersion, widgetMetadata } from "../scripts/widget-metadata.mjs";
const owned: string[] = [];
afterEach(() => {
  for (const path of owned.splice(0)) {
    if (dirname(resolve(path)) !== resolve(tmpdir())) throw new Error("Unowned fixture");
    rmSync(path, { recursive: true, force: true });
  }
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "zappa-sign-test-"));
  owned.push(root);
  const dist = join(root, "dist"),
    buildDir = join(root, "build");
  mkdirSync(join(dist, "assets"), { recursive: true });
  writeFileSync(join(dist, "assets/main.js"), "(function(){})();");
  writeFileSync(join(dist, "assets/vodWorker-fixture.js"), "self.postMessage({ready:true});");
  writeFileSync(join(dist, "index.html"), '<script src="./assets/main.js"></script>');
  writeFileSync(
    join(dist, "config.xml"),
    `<widget xmlns="http://www.w3.org/ns/widgets" xmlns:t="http://tizen.org/ns/widgets" id="http://zappa.local/ZappaTV" version="${packageVersion()}"><t:application id="ZappaTV002.ZappaTV" package="ZappaTV002" required_version="5.0"/><content src="index.html"/></widget>`,
  );
  writeFileSync(
    join(dist, "build-target.json"),
    JSON.stringify({
      target: "5.0",
      version: packageVersion(),
      chromium: 63,
      experimental: false,
    }),
  );
  return {
    dist,
    buildDir,
    unsigned: packageWidget({ distDir: dist, buildDir, target: "5.0" }),
  };
}
function fakeSigning(_cli: string, args: string[]) {
  const stage = args.at(-1)!;
  const files = collectFiles(stage);
  for (const name of ["author-signature.xml", "signature1.xml"])
    files.push({ name, data: Buffer.from("<Signature/>"), mtime: new Date() });
  writeFileSync(join(stage, "signed.wgt"), createZip(files));
}
test("optional signing preserves unsigned input, verifies payload and isolates signed output", () => {
  const { unsigned, buildDir } = fixture();
  const bytes = readFileSync(unsigned.path);
  const result = signWidget({
    buildDir,
    target: "5.0",
    profile: "fixture-only",
    run: fakeSigning,
  });
  expect(readFileSync(unsigned.path)).toEqual(bytes);
  expect(result.path).toBe(join(buildDir, "signed", unsigned.name));
  expect(result.unsignedSha256).toBe(unsigned.sha256);
  expect(result.certificateValidated).toBe(false);
  expect(verifySignedWidget({ file: result.path, target: "5.0" }).sha256).toBe(result.sha256);
  expect(readFileSync(`${result.path}.signing.json`, "utf8")).not.toContain("fixture-only");
});
test("signing failure cannot silently replace the unsigned candidate or report a signed success", () => {
  const { unsigned, buildDir } = fixture();
  const bytes = readFileSync(unsigned.path);
  expect(() =>
    signWidget({
      buildDir,
      target: "5.0",
      profile: "fixture-only",
      run: () => {
        throw new Error("sensitive CLI output");
      },
    }),
  ).toThrow("Optional Tizen signing failed");
  expect(readFileSync(unsigned.path)).toEqual(bytes);
  expect(existsSync(join(buildDir, "signed"))).toBe(false);
  expect(() => verifySignedWidget({ file: unsigned.path, target: "5.0" })).toThrow(
    "signatures",
  );
});
test("metadata stamping is idempotent and refuses invalid version, output name or compiled target", () => {
  const { dist, buildDir } = fixture();
  const file = join(dist, "config.xml");
  stampVersion(file, packageVersion());
  stampVersion(file, packageVersion());
  expect(() => widgetMetadata({ version: "2.4.0-beta" })).toThrow("version");
  expect(() =>
    packageWidget({ distDir: dist, buildDir, target: "5.0", outName: "../wrong.wgt" }),
  ).toThrow("Output name");
  expect(() => packageWidget({ distDir: dist, buildDir, target: "5.5" })).toThrow("Rebuild");
});

test("signature presence cannot hide changed candidate payload", () => {
  const { unsigned, buildDir } = fixture();
  const before = readFileSync(unsigned.path);
  expect(() =>
    signWidget({
      buildDir,
      target: "5.0",
      profile: "fixture-only",
      run: (cli: string, args: string[]) => {
        writeFileSync(
          join(args.at(-1)!, "assets/main.js"),
          "(function(){window.changed=true;})();",
        );
        fakeSigning(cli, args);
      },
    }),
  ).toThrow("changed the selected candidate payload");
  expect(readFileSync(unsigned.path)).toEqual(before);
});
