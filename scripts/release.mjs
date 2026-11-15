import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { packageTargets, widgetName } from "./tv/platforms.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const RELEASE_GATES = {
  source: "Source checks",
  artifact: "Artifact startup",
  engines: "Engine parity",
  gap: "Gap parity",
  budget: "Resource budgets",
};
export const EXPERIMENTAL_GATES = Object.fromEntries(
  packageTargets
    .filter((tv) => tv.package.experimental)
    .map((tv) => [tv.tizen, `Experimental Tizen ${tv.tizen}`]),
);
const HASH = /^[a-f0-9]{64}$/;
const SHA = /^[a-f0-9]{40}$/;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const fail = (message) => {
  throw new Error(message);
};
export const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const requireValue = (condition, message) => {
  if (!condition) fail(message);
};
const text = (value) => typeof value === "string" && value.trim().length > 0;

export function validateReleaseApproval(context) {
  const { ref, tagType, sourceSha, headSha, onMain, version, lockVersion, notes, approval } =
    context;
  requireValue(VERSION.test(version), "Package version must be major.minor.patch.");
  requireValue(
    ref === `refs/tags/v${version}`,
    "Release requires an explicit matching version tag.",
  );
  requireValue(tagType === "tag", "Release tag must be annotated, not lightweight.");
  requireValue(
    SHA.test(sourceSha) && sourceSha === headSha && onMain,
    "Release source must be the checked-out commit on main.",
  );
  requireValue(
    lockVersion === version && text(notes),
    "Lockfile version and release notes must match the tag.",
  );
  requireValue(
    approval?.schemaVersion === 1 &&
      approval.version === version &&
      approval.sourceSha === sourceSha,
    "Tag approval must bind schema, version and exact source SHA.",
  );
  requireValue(Array.isArray(approval.artifacts), "Approved artifacts are required.");
  const targets = new Set();
  const artifacts = approval.artifacts
    .map((artifact) => {
      requireValue(
        ["3.0", "4.0", "5.0", "5.5"].includes(artifact.target) && !targets.has(artifact.target),
        "Artifact targets must be supported and unique.",
      );
      targets.add(artifact.target);
      requireValue(
        artifact.name === widgetName(version, artifact.target) && HASH.test(artifact.sha256),
        "Artifact filename/hash must match its versioned target.",
      );
      return { target: artifact.target, name: artifact.name, sha256: artifact.sha256 };
    })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  requireValue(
    targets.has("5.0") && targets.has("5.5"),
    "Both priority Tizen 5 targets are required.",
  );
  const ciRuns = {};
  for (const gate of Object.keys(RELEASE_GATES)) {
    requireValue(
      Number.isSafeInteger(approval.ciRuns?.[gate]) && approval.ciRuns[gate] > 0,
      `A CI run is required for ${gate}.`,
    );
    ciRuns[gate] = approval.ciRuns[gate];
  }
  for (const target of Object.keys(EXPERIMENTAL_GATES)) {
    if (!targets.has(target)) continue;
    const key = `experimental${target[0]}`;
    requireValue(
      Number.isSafeInteger(approval.ciRuns?.[key]) && approval.ciRuns[key] > 0,
      `Experimental Tizen ${target} requires its own successful gate.`,
    );
    ciRuns[key] = approval.ciRuns[key];
  }
  const hardware = approval.hardware;
  const tested = artifacts.find((artifact) => artifact.target === "5.0");
  requireValue(
    hardware?.accepted === true &&
      text(hardware.approvedBy) &&
      text(hardware.model) &&
      text(hardware.firmware) &&
      /^5(?:\.\d+)*$/.test(hardware.tizen) &&
      hardware.installer === "Apps2Samsung" &&
      Number.isFinite(Date.parse(hardware.testedAt)) &&
      hardware.artifact === tested.name &&
      hardware.sha256 === tested.sha256,
    "Owner Tizen 5 acceptance must identify the exact unsigned artifact and Apps2Samsung installation.",
  );
  return {
    ref,
    version,
    sourceSha,
    notes,
    artifacts,
    ciRuns,
    hardware: {
      accepted: true,
      approvedBy: hardware.approvedBy,
      model: hardware.model,
      firmware: hardware.firmware,
      tizen: hardware.tizen,
      installer: hardware.installer,
      testedAt: hardware.testedAt,
      artifact: hardware.artifact,
      sha256: hardware.sha256,
    },
  };
}

export function loadReleaseContext(root, ref) {
  requireValue(
    /^refs\/tags\/v\d+\.\d+\.\d+$/.test(ref ?? ""),
    "Release requires a version-tag ref; branch pushes cannot publish.",
  );
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  requireValue(
    git("--no-optional-locks", "status", "--porcelain") === "",
    "Release source must have a clean working tree.",
  );
  const tagType = git("cat-file", "-t", ref);
  requireValue(tagType === "tag", "Release tag must be annotated, not lightweight.");
  const raw = git("cat-file", "-p", ref);
  let approval;
  try {
    approval = JSON.parse(
      raw.slice(raw.indexOf("\n\n") + 2).split("\n-----BEGIN PGP SIGNATURE-----")[0],
    );
  } catch {
    fail("Annotated tag must contain a valid JSON approval receipt; contents are not logged.");
  }
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
  const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8");
  const escaped = String(pkg.version).replaceAll(".", "\\.");
  const notes = changelog
    .match(
      new RegExp(
        `^## (?:\\[${escaped}\\]|${escaped})(?:[\\t ]+[^\\n]*)?\\r?\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`,
        "m",
      ),
    )?.[1]
    .trim();
  const sourceSha = git("rev-parse", `${ref}^{commit}`);
  const ancestry = spawnSync(
    "git",
    ["merge-base", "--is-ancestor", sourceSha, "refs/remotes/origin/main"],
    { cwd: root },
  );
  const plan = validateReleaseApproval({
    ref,
    tagType,
    sourceSha,
    headSha: git("rev-parse", "HEAD"),
    onMain: ancestry.status === 0,
    version: pkg.version,
    lockVersion: lock.version === lock.packages?.[""]?.version ? lock.version : "",
    notes,
    approval,
  });
  return { ...plan, sourceDateEpoch: Number(git("show", "-s", "--format=%ct", sourceSha)) };
}

export function readReleaseFiles(plan, directory) {
  return plan.artifacts
    .flatMap((artifact) => {
      const bytes = readFileSync(join(directory, artifact.name));
      requireValue(
        digest(bytes) === artifact.sha256,
        `Artifact hash differs from TV-approved bytes: ${artifact.name}`,
      );
      const checksumName = `${artifact.name}.sha256`;
      const checksum = readFileSync(join(directory, checksumName));
      requireValue(
        checksum.toString("utf8") === `${artifact.sha256}  ${artifact.name}\n`,
        `Invalid checksum sidecar: ${checksumName}`,
      );
      return [
        { name: artifact.name, bytes, sha256: artifact.sha256 },
        { name: checksumName, bytes: checksum, sha256: digest(checksum) },
      ];
    })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

export function createGiteaClient({ serverUrl, repository, token, fetchImpl = fetch }) {
  const server = new URL(serverUrl);
  requireValue(
    server.protocol === "https:" &&
      !server.username &&
      !server.password &&
      !server.search &&
      !server.hash,
    "Gitea must use an HTTPS server URL without embedded credentials.",
  );
  requireValue(/^[\w.-]+\/[\w.-]+$/.test(repository), "Invalid Gitea repository identity.");
  requireValue(text(token), "A scoped Gitea job token is required; no token value is logged.");
  const base = `${server.href.replace(/\/$/, "")}/api/v1/repos/${repository}`;
  async function request(
    path,
    { method = "GET", body, binary = false, optional = false } = {},
  ) {
    const url = new URL(path.startsWith("https://") ? path : `${base}${path}`);
    requireValue(
      url.origin === server.origin,
      "Refusing to send job credentials to another origin.",
    );
    let response;
    try {
      response = await fetchImpl(url.href, {
        method,
        body: body === undefined ? undefined : binary ? body : JSON.stringify(body),
        headers: {
          Authorization: `token ${token}`,
          ...(body === undefined
            ? {}
            : { "Content-Type": binary ? "application/octet-stream" : "application/json" }),
        },
        redirect: "error",
        signal: AbortSignal.timeout(60_000),
      });
    } catch {
      fail(`Gitea ${method} request failed or timed out; reconcile state before retrying.`);
    }
    if (optional && response.status === 404) return null;
    requireValue(
      response.ok,
      `Gitea ${method} returned HTTP ${response.status}; check effective job-token permissions.`,
    );
    return response;
  }
  const json = async (response) => {
    try {
      return await response.json();
    } catch {
      fail("Gitea returned invalid JSON metadata; response contents are not logged.");
    }
  };
  return {
    async read(path, optional = false) {
      const response = await request(path, { optional });
      return response ? json(response) : null;
    },
    async download(url) {
      return Buffer.from(await (await request(url)).arrayBuffer());
    },
    async create(body) {
      return json(await request("/releases", { method: "POST", body }));
    },
    async upload(id, file) {
      return json(
        await request(`/releases/${id}/assets?name=${encodeURIComponent(file.name)}`, {
          method: "POST",
          body: file.bytes,
          binary: true,
        }),
      );
    },
    async publish(id) {
      return json(
        await request(`/releases/${id}`, { method: "PATCH", body: { draft: false } }),
      );
    },
  };
}

function versionParts(tag) {
  const value = String(tag).replace(/^v/, "");
  return VERSION.test(value) ? value.split(".").map(Number) : null;
}
function newer(left, right) {
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] > right[i];
  }
  return false;
}

export async function verifyReleaseEvidence(plan, client) {
  const existing = await client.read(`/releases/tags/v${plan.version}`, true);
  requireValue(
    !existing || existing.draft,
    "This version is already published; no assets will be replaced.",
  );
  let finished = false;
  for (let page = 1; page <= 100; page++) {
    const releases = await client.read(`/releases?limit=50&page=${page}`);
    requireValue(Array.isArray(releases), "Invalid release-list response.");
    for (const release of releases) {
      const parts = versionParts(release.tag_name);
      if (!release.draft && parts)
        requireValue(
          newer(versionParts(plan.version), parts),
          "Release version must be newer than every published version.",
        );
    }
    if (releases.length < 50) {
      finished = true;
      break;
    }
  }
  requireValue(finished, "Release history exceeded the bounded verification window.");
  const omitted = new Set(
    Object.entries(EXPERIMENTAL_GATES)
      .filter(([target]) => !plan.artifacts.some((artifact) => artifact.target === target))
      .map(([, name]) => name),
  );
  const seen = new Map();
  for (const [gate, id] of Object.entries(plan.ciRuns)) {
    if (!seen.has(id)) {
      const run = await client.read(`/actions/runs/${id}`);
      const result = await client.read(`/actions/runs/${id}/jobs`);
      requireValue(
        run.head_sha === plan.sourceSha &&
          run.status === "completed" &&
          ["success", "failure"].includes(run.conclusion) &&
          Array.isArray(result.jobs) &&
          result.jobs.length > 0 &&
          result.total_count === result.jobs.length,
        "CI evidence must be completed and match the exact release commit.",
      );
      for (const job of result.jobs) {
        requireValue(
          job.head_sha === plan.sourceSha &&
            job.status === "completed" &&
            (job.conclusion === "success" || omitted.has(job.name)),
          "A required or unknown CI job did not pass.",
        );
      }
      if (run.conclusion === "failure") {
        requireValue(
          result.jobs.some((job) => omitted.has(job.name) && job.conclusion !== "success"),
          "A failed CI run is eligible only for explicitly omitted experimental assets.",
        );
      }
      seen.set(id, result.jobs);
    }
    const name = RELEASE_GATES[gate] ?? EXPERIMENTAL_GATES[`${gate.slice(-1)}.0`];
    requireValue(
      seen.get(id).some((job) => job.name === name && job.conclusion === "success"),
      `Missing successful CI gate: ${name}`,
    );
  }
}

export async function stageAndPublish(plan, files, client, publicationId) {
  requireValue(
    text(publicationId) && /^[\w.-]+$/.test(publicationId),
    "An explicit publication identity is required.",
  );
  const metadata = {
    ...plan,
    files: files.map(({ name, sha256, bytes }) => ({ name, sha256, bytes: bytes.length })),
  };
  const marker = `<!-- zappa-publication:${publicationId}:${digest(JSON.stringify(metadata))} -->`;
  const path = `/releases/tags/v${plan.version}`;
  const owned = (release) => {
    requireValue(
      Number.isSafeInteger(release?.id) &&
        release.id > 0 &&
        release.draft &&
        release.tag_name === `v${plan.version}` &&
        release.target_commitish === plan.sourceSha &&
        release.body?.endsWith(marker),
      "Existing release is published, foreign, or has different evidence; no replacement is allowed.",
    );
    return release;
  };
  let release = await client.read(path, true);
  if (release) owned(release);
  else {
    try {
      release = await client.create({
        tag_name: `v${plan.version}`,
        target_commitish: plan.sourceSha,
        name: `v${plan.version}`,
        draft: true,
        prerelease: false,
        body: `${plan.notes}\n\nTV acceptance: ${plan.hardware.model}, Tizen ${plan.hardware.tizen}, Apps2Samsung. Other TV versions remain unverified.\n\n${marker}`,
      });
    } catch (error) {
      // Creating a version is the atomic ownership boundary. A concurrent run or
      // lost response may have created it; only this publication may resume it.
      release = await client.read(path, true);
      if (!release) throw error;
    }
    owned(release);
  }
  const expected = new Map(files.map((file) => [file.name, file]));
  const inspect = async () => {
    const assets = await client.read(`/releases/${release.id}/assets`);
    requireValue(Array.isArray(assets), "Invalid release attachment response.");
    const names = new Set();
    for (const asset of assets) {
      const file = expected.get(asset.name);
      requireValue(
        file && !names.has(asset.name),
        "Unexpected or duplicate draft asset; refusing deletion or replacement.",
      );
      names.add(asset.name);
      requireValue(
        asset.size === file.bytes.length &&
          digest(await client.download(asset.browser_download_url)) === file.sha256,
        `Remote draft bytes differ: ${asset.name}`,
      );
    }
    return names;
  };
  let present = await inspect();
  for (const file of files) {
    if (present.has(file.name)) continue;
    try {
      await client.upload(release.id, file);
    } catch {
      // A failed upload response is not proof of a failed write. Reconcile once;
      // never retry a POST blindly or treat a partial draft as a public release.
      present = await inspect();
      requireValue(
        present.has(file.name),
        `Upload outcome unresolved for ${file.name}; draft preserved.`,
      );
    }
    present = await inspect();
    requireValue(present.has(file.name), `Uploaded asset is missing: ${file.name}`);
  }
  requireValue(present.size === expected.size, "Draft asset set is incomplete.");
  try {
    await client.publish(release.id);
  } catch {
    const reconciled = await client.read(`/releases/${release.id}`);
    requireValue(
      reconciled?.draft === false && reconciled.body?.endsWith(marker),
      "Publication outcome unresolved; inspect the draft before retrying.",
    );
  }
  const published = await client.read(`/releases/${release.id}`);
  requireValue(
    published.draft === false &&
      published.target_commitish === plan.sourceSha &&
      published.body?.endsWith(marker),
    "Publication state does not match the approved release.",
  );
  await inspect();
  return published;
}

export async function runRelease({
  root = ROOT,
  ref,
  serverUrl,
  repository,
  token,
  mode = "dry-run",
  publicationId,
  fetchImpl,
}) {
  requireValue(
    ["preflight", "dry-run", "publish"].includes(mode),
    "Unknown release operation.",
  );
  const plan = loadReleaseContext(root, ref);
  const client = createGiteaClient({ serverUrl, repository, token, fetchImpl });
  await verifyReleaseEvidence(plan, client);
  if (mode === "preflight") return plan;
  const files = readReleaseFiles(plan, join(root, "build"));
  const manifest = {
    ...plan,
    files: files.map(({ name, sha256, bytes }) => ({ name, sha256, bytes: bytes.length })),
  };
  if (mode === "publish") await stageAndPublish(plan, files, client, publicationId);
  mkdirSync(join(root, "build"), { recursive: true });
  writeFileSync(
    join(root, "build", "release-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return manifest;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const args = process.argv.slice(2);
    requireValue(
      args.length <= 1 &&
        args.every((arg) => ["--preflight", "--dry-run", "--publish"].includes(arg)),
      "Use --preflight, --dry-run or --publish.",
    );
    const result = await runRelease({
      ref: process.env.CI_TAG_REF,
      serverUrl: process.env.CI_SERVER_URL,
      repository: process.env.CI_REPOSITORY,
      token: process.env.RELEASE_TOKEN,
      mode: args[0]?.slice(2) ?? "dry-run",
      publicationId: process.env.CI_PUBLICATION_ID,
    });
    console.log(
      `Release ${result.version}: ${args[0] ?? "--dry-run"} verified for ${result.sourceSha}.`,
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
