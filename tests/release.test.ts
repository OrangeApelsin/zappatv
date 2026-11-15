import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import {
  createGiteaClient,
  digest,
  EXPERIMENTAL_GATES,
  loadReleaseContext,
  readReleaseFiles,
  RELEASE_GATES,
  runRelease,
  stageAndPublish,
  validateReleaseApproval,
  verifyReleaseEvidence,
} from "../scripts/release.mjs";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
const directory = () => {
  const path = mkdtempSync(join(tmpdir(), "zappa-release-"));
  directories.push(path);
  return path;
};
function context() {
  const artifacts = ["5.0", "5.5"].map((target) => {
    const name = `zappa-2.5.0${target === "5.0" ? "-tizen5" : ""}.wgt`;
    return { target, name, sha256: digest(Buffer.from(name)) };
  });
  return {
    ref: "refs/tags/v2.5.0",
    tagType: "tag",
    sourceSha: "a".repeat(40),
    headSha: "a".repeat(40),
    onMain: true,
    version: "2.5.0",
    lockVersion: "2.5.0",
    notes: "Recovery fixture notes.",
    approval: {
      schemaVersion: 1,
      version: "2.5.0",
      sourceSha: "a".repeat(40),
      artifacts,
      ciRuns: Object.fromEntries(Object.keys(RELEASE_GATES).map((gate) => [gate, 10])),
      hardware: {
        accepted: true,
        approvedBy: "fixture owner",
        model: "QE55Q70RATXXC",
        firmware: "fixture firmware",
        tizen: "5",
        installer: "Apps2Samsung",
        testedAt: "2026-11-08T12:00:00Z",
        artifact: artifacts[0].name,
        sha256: artifacts[0].sha256,
      },
    },
  };
}
function fixtureFiles(plan: ReturnType<typeof validateReleaseApproval>) {
  return plan.artifacts
    .flatMap((artifact: { name: string; sha256: string }) => [
      { name: artifact.name, bytes: Buffer.from(artifact.name), sha256: artifact.sha256 },
      {
        name: `${artifact.name}.sha256`,
        bytes: Buffer.from(`${artifact.sha256}  ${artifact.name}\n`),
        sha256: digest(Buffer.from(`${artifact.sha256}  ${artifact.name}\n`)),
      },
    ])
    .sort((a: { name: string }, b: { name: string }) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
}

type MutableRelease = {
  id: number;
  draft: boolean;
  body: string;
  tag_name: string;
  target_commitish: string;
};
function fakeGitea(plan: ReturnType<typeof validateReleaseApproval>) {
  const state = {
    release: null as MutableRelease | null,
    assets: new Map<
      string,
      { id: number; name: string; size: number; browser_download_url: string; bytes: Buffer }
    >(),
    methods: [] as string[],
    uploadCount: 0,
    failUploadAt: 0,
    loseUploadAt: 0,
    loseCreate: false,
    losePublish: false,
    denyCreate: false,
    failPublish: false,
    publishedTags: ["v2.4.0"],
    jobs: Object.values(RELEASE_GATES).map((name) => ({
      name,
      head_sha: plan.sourceSha,
      status: "completed",
      conclusion: "success",
    })),
    runSha: plan.sourceSha,
    runConclusion: "success",
  };
  const json = (value: unknown, status = 200) =>
    new Response(JSON.stringify(value), { status });
  const fetchImpl = async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    const method = init.method ?? "GET";
    state.methods.push(method);
    if (url.pathname.startsWith("/attachments/")) {
      const asset = [...state.assets.values()].find(
        (item) => url.pathname === `/attachments/${item.id}`,
      );
      return asset ? new Response(asset.bytes) : json({}, 404);
    }
    const path = url.pathname.replace(/^\/api\/v1\/repos\/[\w.-]+\/[\w.-]+/, "");
    if (path === "/actions/runs/10")
      return json({
        head_sha: state.runSha,
        status: "completed",
        conclusion: state.runConclusion,
      });
    if (path === "/actions/runs/10/jobs")
      return json({ jobs: state.jobs, total_count: state.jobs.length });
    if (path === "/releases/tags/v2.5.0")
      return state.release ? json(state.release) : json({}, 404);
    if (path === "/releases" && method === "GET")
      return json([
        ...state.publishedTags.map((tag_name) => ({ tag_name, draft: false })),
        ...(state.release ? [state.release] : []),
      ]);
    if (path === "/releases" && method === "POST") {
      if (state.denyCreate) return json({}, 403);
      if (state.release) return json({}, 409);
      state.release = { id: 42, ...JSON.parse(String(init.body)) };
      if (state.loseCreate) {
        state.loseCreate = false;
        throw new Error("lost create response");
      }
      return json(state.release, 201);
    }
    if (path === "/releases/42/assets" && method === "GET")
      return json([...state.assets.values()].map(({ bytes: _bytes, ...asset }) => asset));
    if (path === "/releases/42/assets" && method === "POST") {
      state.uploadCount++;
      if (state.uploadCount === state.failUploadAt) return json({}, 503);
      const name = url.searchParams.get("name")!;
      if (state.assets.has(name)) return json({}, 409);
      if (!Buffer.isBuffer(init.body)) throw new Error("Expected raw octet-stream upload.");
      const id = state.assets.size + 1;
      const asset = {
        id,
        name,
        bytes: init.body,
        size: init.body.length,
        browser_download_url: `https://git.example/attachments/${id}`,
      };
      state.assets.set(name, asset);
      if (state.uploadCount === state.loseUploadAt) throw new Error("lost upload response");
      return json(asset, 201);
    }
    if (path === "/releases/42" && method === "PATCH") {
      if (state.failPublish) return json({}, 503);
      state.release!.draft = false;
      if (state.losePublish) {
        state.losePublish = false;
        throw new Error("lost publish response");
      }
      return json(state.release);
    }
    if (path === "/releases/42") return json(state.release);
    throw new Error(`Unexpected fixture route: ${method} ${path}`);
  };
  const client = createGiteaClient({
    serverUrl: "https://git.example",
    repository: "owner/zappa2",
    token: "fixture-token",
    fetchImpl,
  });
  return { state, client, fetchImpl };
}

test.each([
  "branch",
  "lightweight",
  "version",
  "lock",
  "notes",
  "source",
  "main",
  "approval",
  "CI",
  "hardware",
  "hash",
])("release validation rejects missing or mismatched %s evidence", (kind) => {
  const value = context();
  if (kind === "branch") value.ref = "refs/heads/main";
  if (kind === "lightweight") value.tagType = "commit";
  if (kind === "version") value.ref = "refs/tags/v2.6.0";
  if (kind === "lock") value.lockVersion = "2.4.0";
  if (kind === "notes") value.notes = "";
  if (kind === "source") value.headSha = "b".repeat(40);
  if (kind === "main") value.onMain = false;
  if (kind === "approval") value.approval.sourceSha = "b".repeat(40);
  if (kind === "CI") delete value.approval.ciRuns.budget;
  if (kind === "hardware") value.approval.hardware.accepted = false;
  if (kind === "hash") value.approval.hardware.sha256 = "0".repeat(64);
  expect(() => validateReleaseApproval(value)).toThrow();
});

test("annotated-tag loading binds actual Git source, main ancestry, lockfile and notes", () => {
  const root = directory();
  const git = (...args: string[]) =>
    execFileSync(
      "git",
      ["-c", "user.name=Release fixture", "-c", "user.email=fixture@example.invalid", ...args],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
  git("init", "--quiet");
  writeFileSync(join(root, ".gitignore"), "build/\n");
  writeFileSync(join(root, "package.json"), JSON.stringify({ version: "2.5.0" }));
  writeFileSync(
    join(root, "package-lock.json"),
    JSON.stringify({ version: "2.5.0", packages: { "": { version: "2.5.0" } } }),
  );
  writeFileSync(
    join(root, "CHANGELOG.md"),
    "# Changelog\n\n## 2.5.0\n\nRecovery fixture notes.\n\n## 2.4.0\nOld notes.\n",
  );
  git("add", ".gitignore", "package.json", "package-lock.json", "CHANGELOG.md");
  git("commit", "--quiet", "-m", "fixture");
  const sha = git("rev-parse", "HEAD");
  git("update-ref", "refs/remotes/origin/main", sha);
  const approval = { ...context().approval, sourceSha: sha };
  git("tag", "-a", "v2.5.0", "-m", JSON.stringify(approval));
  const plan = loadReleaseContext(root, "refs/tags/v2.5.0");
  expect(plan.sourceSha).toBe(sha);
  expect(plan.notes).toBe("Recovery fixture notes.");
  git("tag", "v2.6.0");
  expect(() => loadReleaseContext(root, "refs/tags/v2.6.0")).toThrow("annotated");
  const files = fixtureFiles(plan);
  mkdirSync(join(root, "build"));
  for (const file of files) writeFileSync(join(root, "build", file.name), file.bytes);
  const api = fakeGitea(plan);
  return runRelease({
    root,
    ref: "refs/tags/v2.5.0",
    serverUrl: "https://git.example",
    repository: "owner/zappa2",
    token: "fixture-token",
    fetchImpl: api.fetchImpl,
  }).then(() => {
    expect(api.state.methods.every((method) => method === "GET")).toBe(true);
    expect(
      JSON.parse(readFileSync(join(root, "build/release-manifest.json"), "utf8")).sourceSha,
    ).toBe(sha);
    writeFileSync(join(root, "CHANGELOG.md"), "uncommitted change");
    expect(() => loadReleaseContext(root, "refs/tags/v2.5.0")).toThrow("clean working tree");
  });
});

test("missing credentials and cross-origin attachment downloads fail without disclosure", async () => {
  expect(() =>
    createGiteaClient({
      serverUrl: "https://git.example",
      repository: "owner/zappa2",
      token: "",
    }),
  ).toThrow("token is required");
  const api = fakeGitea(validateReleaseApproval(context()));
  await expect(api.client.download("https://another.example/asset")).rejects.toThrow(
    "another origin",
  );
  expect(api.state.methods).toEqual([]);
});

test("local hashes and checksum sidecars must match approved bytes", () => {
  const plan = validateReleaseApproval(context());
  const root = directory();
  for (const file of fixtureFiles(plan)) writeFileSync(join(root, file.name), file.bytes);
  expect(readReleaseFiles(plan, root)).toHaveLength(4);
  writeFileSync(join(root, plan.artifacts[0].name), "changed after TV acceptance");
  expect(() => readReleaseFiles(plan, root)).toThrow("hash differs");
});

test("CI proof rejects diagnostic substitutes and wrong-head runs", async () => {
  const plan = validateReleaseApproval(context());
  const api = fakeGitea(plan);
  await verifyReleaseEvidence(plan, api.client);
  api.state.jobs[0].name = "TV source (diagnostic)";
  await expect(verifyReleaseEvidence(plan, api.client)).rejects.toThrow(
    "Missing successful CI gate",
  );
  api.state.jobs[0].name = RELEASE_GATES.source;
  api.state.runSha = "b".repeat(40);
  await expect(verifyReleaseEvidence(plan, api.client)).rejects.toThrow("exact release commit");
});

test("only failures belonging to omitted experimental assets are eligible", async () => {
  const plan = validateReleaseApproval(context());
  const api = fakeGitea(plan);
  api.state.jobs.push({
    name: EXPERIMENTAL_GATES["3.0"],
    head_sha: plan.sourceSha,
    status: "completed",
    conclusion: "failure",
  });
  api.state.runConclusion = "failure";
  await verifyReleaseEvidence(plan, api.client);
  api.state.jobs.at(-1)!.name = "Unknown failed verification";
  await expect(verifyReleaseEvidence(plan, api.client)).rejects.toThrow("did not pass");
});

test("included experimental targets need their own accepted CI evidence", () => {
  const value = context();
  value.approval.artifacts.push({
    target: "3.0",
    name: "zappa-2.5.0-tizen3.wgt",
    sha256: "c".repeat(64),
  });
  expect(() => validateReleaseApproval(value)).toThrow("requires its own successful gate");
});

test("nonincremented versions and cancelled CI runs cannot reach publication", async () => {
  const plan = validateReleaseApproval(context());
  const api = fakeGitea(plan);
  api.state.publishedTags.push("v2.6.0");
  await expect(verifyReleaseEvidence(plan, api.client)).rejects.toThrow("newer");
  api.state.publishedTags.pop();
  api.state.runConclusion = "cancelled";
  await expect(verifyReleaseEvidence(plan, api.client)).rejects.toThrow("completed");
  expect(api.state.methods.every((method) => method === "GET")).toBe(true);
});

test("draft publication verifies the complete set and refuses a published version", async () => {
  const plan = validateReleaseApproval(context());
  const files = fixtureFiles(plan);
  const api = fakeGitea(plan);
  await stageAndPublish(plan, files, api.client, "run-1");
  expect(api.state.release?.draft).toBe(false);
  expect(api.state.assets.size).toBe(files.length);
  const writes = api.state.methods.filter((method) => method !== "GET").length;
  await expect(stageAndPublish(plan, files, api.client, "run-1")).rejects.toThrow(
    "no replacement",
  );
  await expect(verifyReleaseEvidence(plan, api.client)).rejects.toThrow("already published");
  expect(api.state.methods.filter((method) => method !== "GET")).toHaveLength(writes);
  expect(api.state.methods).not.toContain("DELETE");
});

test("partial upload remains a draft and only the same publication can resume", async () => {
  const plan = validateReleaseApproval(context());
  const api = fakeGitea(plan);
  api.state.failUploadAt = 2;
  await expect(stageAndPublish(plan, fixtureFiles(plan), api.client, "run-1")).rejects.toThrow(
    "draft preserved",
  );
  expect(api.state.release?.draft).toBe(true);
  expect(api.state.assets.size).toBe(1);
  await expect(stageAndPublish(plan, fixtureFiles(plan), api.client, "run-2")).rejects.toThrow(
    "foreign",
  );
  api.state.failUploadAt = 0;
  await stageAndPublish(plan, fixtureFiles(plan), api.client, "run-1");
  expect(api.state.release?.draft).toBe(false);
  expect(api.state.uploadCount).toBe(5);
});

test("lost create, upload and publish responses are reconciled without blind POST retries", async () => {
  const plan = validateReleaseApproval(context());
  const api = fakeGitea(plan);
  api.state.loseCreate = true;
  api.state.loseUploadAt = 1;
  api.state.losePublish = true;
  await stageAndPublish(plan, fixtureFiles(plan), api.client, "run-1");
  expect(api.state.release?.draft).toBe(false);
  expect(api.state.uploadCount).toBe(4);
});

test("concurrent publication identities cannot both own a version", async () => {
  const plan = validateReleaseApproval(context());
  const api = fakeGitea(plan);
  const results = await Promise.allSettled([
    stageAndPublish(plan, fixtureFiles(plan), api.client, "run-1"),
    stageAndPublish(plan, fixtureFiles(plan), api.client, "run-2"),
  ]);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(api.state.uploadCount).toBe(4);
  expect(api.state.methods).not.toContain("DELETE");
});

test("remote corruption stops a resumed draft without deleting assets", async () => {
  const plan = validateReleaseApproval(context());
  const api = fakeGitea(plan);
  api.state.failUploadAt = 2;
  await expect(
    stageAndPublish(plan, fixtureFiles(plan), api.client, "run-1"),
  ).rejects.toThrow();
  const asset = [...api.state.assets.values()][0];
  asset.bytes = Buffer.from("corrupt bytes");
  await expect(stageAndPublish(plan, fixtureFiles(plan), api.client, "run-1")).rejects.toThrow(
    "Remote draft bytes differ",
  );
  expect(api.state.release?.draft).toBe(true);
  expect(api.state.methods).not.toContain("DELETE");
});

test("a failed final publication cannot report success or expose a partial set", async () => {
  const plan = validateReleaseApproval(context());
  const api = fakeGitea(plan);
  api.state.failPublish = true;
  await expect(stageAndPublish(plan, fixtureFiles(plan), api.client, "run-1")).rejects.toThrow(
    "Publication outcome unresolved",
  );
  expect(api.state.release?.draft).toBe(true);
  expect(api.state.assets.size).toBe(4);
});

test("clamped write permissions fail clearly without creating a draft", async () => {
  const plan = validateReleaseApproval(context());
  const api = fakeGitea(plan);
  api.state.denyCreate = true;
  await expect(stageAndPublish(plan, fixtureFiles(plan), api.client, "run-1")).rejects.toThrow(
    "HTTP 403",
  );
  expect(api.state.release).toBeNull();
  expect(api.state.assets.size).toBe(0);
});
