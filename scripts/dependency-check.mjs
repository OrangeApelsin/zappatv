import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Carry the former runtime-license review boundary into Gitea without an external action. */
export function dependencyLicenseFindings(lockfile) {
  if (!lockfile.packages?.[""]) {
    throw new Error("Lockfile package metadata is missing; dependency review cannot run.");
  }
  return Object.entries(lockfile.packages).flatMap(([path, entry]) => {
    if (!path || entry.dev) return [];
    const license = typeof entry.license === "string" ? entry.license : "";
    if (!license || /^UNLICENSED$/i.test(license) || /\b(?:AGPL|GPL)-\d/i.test(license)) {
      return [{ path, license: license || "(missing)", reason: "runtime license review required" }];
    }
    return [];
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const lockfile = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
  const findings = dependencyLicenseFindings(lockfile);
  if (findings.length) {
    for (const finding of findings) {
      console.error(`${finding.path}: ${finding.license} — ${finding.reason}`);
    }
    process.exitCode = 1;
  } else {
    console.log("Runtime license review: no missing, unlicensed, GPL or AGPL declarations found.");
  }
}
