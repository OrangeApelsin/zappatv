import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const workflowsDirectory = join(process.cwd(), ".gitea", "workflows");
const ci = readFileSync(join(workflowsDirectory, "ci.yml"), "utf8");
const lines = ci.split(/\r?\n/);
const checksStart = lines.indexOf("  checks:");

test("Gitea workflows do not embed literal credential environment values", () => {
  const literalCredential =
    /^\s*(?:[A-Z][A-Z0-9_]*_)?(?:TOKEN|PASSWORD|SECRET)(?:_[A-Z0-9_]+)?:\s*["']?[A-Za-z0-9_+/=-]{16,}/m;
  const offendingFiles = readdirSync(workflowsDirectory)
    .filter((file) => /\.ya?ml$/.test(file))
    .filter((file) =>
      literalCredential.test(readFileSync(join(workflowsDirectory, file), "utf8")),
    );

  // Report filenames only: a failed guard must not echo the credential into CI logs.
  expect(offendingFiles).toEqual([]);
});

test("the verification job cannot consume repository secrets or publish releases", () => {
  expect(checksStart >= 0).toBe(true);
  const nextJobOffset = lines
    .slice(checksStart + 1)
    .findIndex((line) => /^ {2}[A-Za-z][\w-]*:\s*$/.test(line));
  const checksJob = lines
    .slice(checksStart, nextJobOffset < 0 ? undefined : checksStart + 1 + nextJobOffset)
    .join("\n");

  // The checkout step may use Gitea's ephemeral token; release secrets belong in a
  // separate, explicitly gated publication job introduced by TICKET-1704.
  expect(/\bsecrets\s*(?:\.|\[)/.test(checksJob)).toBe(false);
  expect(/\b(?:GITEA|RELEASE|PUBLISH)_TOKEN\s*:/.test(checksJob)).toBe(false);
  expect(/\/releases(?:\/|\?|["'])/.test(checksJob)).toBe(false);
});

test("project hosting and security guidance cannot depend on retired GitHub services", () => {
  expect(existsSync(".github")).toBe(false);
  const retiredProject =
    /github\.com\/(?:dany\/zappa2|shayanline\/(?:OpenIPTV|zappa2))|shayanline\.github\.io\/OpenIPTV/i;
  const files = ["README.md", "CONTRIBUTING.md", "SECURITY.md", "docs/publishing.md"].filter(
    (file) => existsSync(file),
  );
  for (const file of files) {
    expect(retiredProject.test(readFileSync(file, "utf8"))).toBe(false);
  }
});

test("verification and diagnostic job tokens explicitly deny release writes", () => {
  for (const file of ["ci.yml", "tv-checks.yml"]) {
    const workflow = readFileSync(join(workflowsDirectory, file), "utf8");
    const permissions = workflow.split(/^permissions:\s*$/m)[1]?.split(/^jobs:\s*$/m)[0];
    expect(permissions !== undefined).toBe(true);
    expect(/^ {2}code: read\s*$/m.test(permissions ?? "")).toBe(true);
    expect(/^ {2}releases: none\s*$/m.test(permissions ?? "")).toBe(true);
  }
});

test("publication requires a version-tag event and a separate successful verification job", () => {
  const workflow = readFileSync(join(workflowsDirectory, "release.yml"), "utf8");
  expect(/^ {2}push:\r?\n {4}tags: \['v\*'\]/m.test(workflow)).toBe(true);
  expect(/pull_request:|workflow_dispatch:|branches:/.test(workflow)).toBe(false);
  const [verification, publisher] = workflow.split(/^ {2}publish:\s*$/m);
  expect(/releases: write/.test(verification)).toBe(false);
  expect(/needs: verify/.test(publisher ?? "")).toBe(true);
  expect(/releases: write/.test(publisher ?? "")).toBe(true);
  expect(/secrets\s*(?:\.|\[)/.test(workflow)).toBe(false);
});
