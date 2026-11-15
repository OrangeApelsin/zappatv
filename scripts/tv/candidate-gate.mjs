#!/usr/bin/env node
/** Final-WGT gate: exact source/hash evidence, no signing, publication or TV claims. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { checkWidget } from "../check-widget.mjs";
import { arg } from "./cdp.mjs";
import { targetPolicy, widgetName } from "./platforms.mjs";

const target = targetPolicy(arg("target")).tizen;
const mode = arg("mode") ?? "startup";
if (!["syntax", "startup", "engine"].includes(mode)) throw new Error("Unknown candidate gate.");
const policy = targetPolicy(target);
const version = JSON.parse(readFileSync("package.json", "utf8")).version;
const source = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const sourceDirty = Boolean(
  execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim(),
);
const file = resolve(arg("wgt") ?? join("build", widgetName(version, target)));
const bytes = readFileSync(file);
const hash = createHash("sha256").update(bytes).digest("hex");
const evidenceDir = resolve("build/candidate-evidence");
mkdirSync(evidenceDir, { recursive: true });
const temp = mkdtempSync(join(evidenceDir, "extracted-"));
const root = join(temp, "widget");
const report = {
  source,
  sourceDirty,
  target,
  version,
  mode,
  sha256: hash,
  bytes: bytes.length,
  experimental: policy.package.experimental,
  unsigned: null,
  simulation: true,
  hardwareTested: false,
  results: [],
  status: "failed",
};
try {
  if (process.env.CI && sourceDirty) throw new Error("CI candidate source must be clean.");
  execFileSync(process.platform === "win32" ? "python" : "python3", [
    "scripts/extract-widget.py",
    file,
    root,
  ]);
  // Signing is deliberately outside the candidate pipeline (Apps2Samsung).
  for (const name of ["author-signature.xml", "signature1.xml"])
    try {
      readFileSync(join(root, name));
      throw new Error("Expected an unsigned WGT.");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  report.unsigned = true;
  report.artifact = checkWidget({ root, target, version });
  if (mode !== "syntax") {
    const engines =
      mode === "engine"
        ? arg("engine")
          ? [arg("engine")]
          : [target, ...(target === "5.5" ? ["10.0"] : [])]
        : [null];
    for (const engine of engines) {
      const args = ["scripts/tv/worker-smoke.mjs", `--dir=${root}`, `--target=${target}`];
      if (engine) args.push(`--engine=${engine}`);
      if (arg("binary")) args.push(`--binary=${arg("binary")}`);
      const stdout = execFileSync(process.execPath, args, {
        encoding: "utf8",
        timeout: 120000,
      });
      const observations = stdout
        .trim()
        .split(/\r?\n/)
        .filter((line) => line.startsWith("{"))
        .map(JSON.parse);
      if (observations.length !== 8) throw new Error("Missing worker/startup observations.");
      const layouts = [];
      if (!policy.package.experimental) {
        for (const locale of mode === "engine" ? ["en", "sv", "ar"] : ["en"]) {
          const layoutArgs = [
            "scripts/tv/vod-windowing.mjs",
            `--wgt=${file}`,
            `--target=${target}`,
            "--count=10000",
            "--samples=10",
            "--episodes=true",
            "--ui=true",
            "--native=true",
            `--locale=${locale}`,
          ];
          if (engine) layoutArgs.push(`--engine=${engine}`);
          if (arg("binary")) layoutArgs.push(`--binary=${arg("binary")}`);
          const output = execFileSync(process.execPath, layoutArgs, {
            encoding: "utf8",
            timeout: 120000,
          });
          const result = JSON.parse(
            output
              .trim()
              .split(/\r?\n/)
              .filter((line) => line.startsWith("{"))
              .at(-1),
          );
          if (result.status !== "passed" || result.layouts?.length !== 10)
            throw new Error("Incomplete extracted VOD layout journey");
          if (
            !result.nativePlayback ||
            !["movie", "failureGoBack", "episodeGrid", "episodeList"].every(
              (key) => result.nativePlayback[key] === true,
            )
          )
            throw new Error("Missing packaged native playback handoff evidence");
          if (
            !result.coldLoad?.headings ||
            !result.coldLoad.indeterminate ||
            !result.coldLoad.back ||
            !result.coldLoad.rejoined ||
            result.coldLoad.requests !== 1
          )
            throw new Error("Missing cold catalogue cancellation/reuse evidence");
          layouts.push(result);
        }
      }
      report.results.push({ engine: engine ?? "installed desktop", observations, layouts });
    }
  }
  report.status = "passed";
} catch (error) {
  report.error = error.message;
  if (error.stdout) {
    report.output = error.stdout.toString();
    // Synthetic-fixture observations must remain visible if artifact download is unavailable.
    console.error(report.output);
  }
  process.exitCode = 1;
} finally {
  rmSync(temp, { recursive: true, force: true });
  const path = join(
    evidenceDir,
    `${target}-${mode}${arg("engine") ? `-${arg("engine")}` : ""}.json`,
  );
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    JSON.stringify({
      source,
      target,
      mode,
      sha256: hash,
      status: report.status,
      evidence: path,
    }),
  );
  if (report.error) console.error(report.error);
}
