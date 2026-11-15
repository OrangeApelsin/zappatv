#!/usr/bin/env node
// Optional developer signing only. The owner's Apps2Samsung path stays unsigned.
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { widgetMetadata, sha256 as digest, checksumText } from "./widget-metadata.mjs";
import { collectFiles } from "./package-wgt.mjs";
import { checkWidget } from "./check-widget.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const signatures = new Set(["author-signature.xml", "signature1.xml"]);
function extract(file, destination) {
  execFileSync(
    process.env.PYTHON ?? (process.platform === "win32" ? "python" : "python3"),
    [join(root, "scripts/extract-widget.py"), file, destination],
    { stdio: "pipe" },
  );
}
function ownedTemp() {
  const parent = resolve(tmpdir());
  const path = mkdtempSync(join(parent, "zappa-device-widget-"));
  return {
    path,
    dispose() {
      if (
        dirname(resolve(path)) !== parent ||
        !resolve(path).startsWith(join(parent, "zappa-device-widget-"))
      )
        throw new Error("Refusing cleanup outside owned signing directory.");
      rmSync(path, { recursive: true, force: true });
    },
  };
}
function validate(root, meta, signed) {
  checkWidget({ root, target: meta.target, version: meta.version });
  for (const name of signatures) {
    if (existsSync(join(root, name)) !== signed)
      throw new Error(
        signed
          ? "Signed output is missing required signatures."
          : "Input must be the unsigned candidate.",
      );
  }
}
export function verifySignedWidget({ file, target, version } = {}) {
  if (!file) throw new Error("Select an explicit signed WGT path.");
  const meta = widgetMetadata({ target, version });
  const temp = ownedTemp();
  try {
    extract(resolve(file), join(temp.path, "verified"));
    validate(join(temp.path, "verified"), meta, true);
    return {
      ...meta,
      sha256: digest(readFileSync(file)),
      containsSignatures: true,
      certificateValidated: false,
      deviceTested: false,
    };
  } finally {
    temp.dispose();
  }
}
export function signWidget({
  target,
  version,
  buildDir = join(root, "build"),
  profile = process.env.SIGNING_PROFILE,
  cli = process.env.TIZEN_CLI ?? "tizen",
  run = execFileSync,
} = {}) {
  if (!profile)
    throw new Error(
      "Optional signing requires an explicit SIGNING_PROFILE. Apps2Samsung does not require this step.",
    );
  const meta = widgetMetadata({ target, version });
  const unsigned = join(buildDir, meta.name);
  const inputHash = digest(readFileSync(unsigned));
  const temp = ownedTemp();
  try {
    const staged = join(temp.path, "widget");
    extract(unsigned, staged);
    validate(staged, meta, false);
    const input = collectFiles(staged);
    try {
      run(cli, ["package", "-t", "wgt", "-s", profile, "--", staged], { stdio: "pipe" });
    } catch {
      throw new Error(
        "Optional Tizen signing failed. Unsigned candidate preserved; no unsigned fallback was reported as signed.",
      );
    }
    const outputs = readdirSync(staged).filter((name) => name.endsWith(".wgt"));
    if (outputs.length !== 1) throw new Error("Signing must produce exactly one WGT.");
    const produced = join(staged, outputs[0]);
    const checked = join(temp.path, "checked");
    extract(produced, checked);
    validate(checked, meta, true);
    const payload = collectFiles(checked).filter((entry) => !signatures.has(entry.name));
    if (
      payload.length !== input.length ||
      input.some(
        (entry) =>
          !payload.some((other) => other.name === entry.name && other.data.equals(entry.data)),
      )
    )
      throw new Error("Signing changed the selected candidate payload.");
    const data = readFileSync(produced);
    const output = join(buildDir, "signed");
    mkdirSync(output, { recursive: true });
    const path = join(output, meta.name);
    const report = {
      ...meta,
      sha256: digest(data),
      unsignedSha256: inputHash,
      containsSignatures: true,
      certificateValidated: false,
      deviceTested: false,
    };
    writeFileSync(path, data);
    writeFileSync(`${path}.sha256`, checksumText(report.sha256, meta.name));
    writeFileSync(`${path}.signing.json`, `${JSON.stringify(report, null, 2)}\n`);
    return { path, ...report };
  } finally {
    temp.dispose();
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const target =
      process.argv.find((value) => value.startsWith("--target="))?.slice(9) ??
      process.env.TIZEN_TARGET ??
      "5.5";
    const file = process.argv.find((value) => value.startsWith("--file="))?.slice(7);
    console.log(
      JSON.stringify(file ? verifySignedWidget({ file, target }) : signWidget({ target })),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
