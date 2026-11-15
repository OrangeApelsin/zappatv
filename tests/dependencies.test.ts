import { expect, test } from "vitest";
import { dependencyLicenseFindings } from "../scripts/dependency-check.mjs";

test("runtime copyleft declarations require review without rejecting development-only tools", () => {
  const findings = dependencyLicenseFindings({
    packages: {
      "": { license: "MIT" },
      "node_modules/runtime": { license: "MIT OR GPL-3.0-only" },
      "node_modules/dev-tool": { dev: true, license: "AGPL-3.0-only" },
      "node_modules/permissive": { license: "Apache-2.0" },
    },
  });
  expect(findings.map((finding: { path: string }) => finding.path)).toEqual([
    "node_modules/runtime",
  ]);
});

test("missing or unlicensed runtime declarations cannot silently pass", () => {
  const findings = dependencyLicenseFindings({
    packages: {
      "": {},
      "node_modules/missing": {},
      "node_modules/unlicensed": { license: "UNLICENSED" },
      "node_modules/mit": { license: "MIT" },
    },
  });
  expect(findings).toHaveLength(2);
  expect(() => dependencyLicenseFindings({})).toThrow("metadata is missing");
});
