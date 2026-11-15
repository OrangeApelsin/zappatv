/** Gitea's artifact v4 protocol. Job-scoped runtime token only; no repository PAT.
 * Primary protocol: go-gitea/gitea routers/api/actions/artifact.proto + artifactsv4.go.
 * Upload only explicitly selected unsigned candidates/evidence, then hash the download.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createZip } from "./package-wgt.mjs";
import { widgetName } from "./tv/platforms.mjs";
const digest = (data) => createHash("sha256").update(data).digest("hex");

export async function uploadArtifact({ name, bytes, env = process.env, fetcher = fetch }) {
  if (
    !/^[a-zA-Z0-9._-]{1,200}$/.test(name) ||
    !bytes.length ||
    bytes.length > 128 * 1024 * 1024
  )
    throw new Error("Invalid or oversized CI artifact.");
  const token = env.ACTIONS_RUNTIME_TOKEN;
  const results = env.ACTIONS_RESULTS_URL;
  if (!token || !results) throw new Error("Gitea artifact v4 runtime credentials unavailable.");
  const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
  const scope = claims.scp?.split(" ").find((item) => item.startsWith("Actions.Results:"));
  const [, run, job] = scope?.split(":") ?? [];
  if (!run || !job) throw new Error("Missing artifact runtime scope.");
  const artifactName = `${name}-${job}`;
  const base = {
    workflow_run_backend_id: run,
    workflow_job_run_backend_id: job,
    name: artifactName,
  };
  const send = async (url, init) => {
    const address = new URL(url);
    if (!["http:", "https:"].includes(address.protocol) || address.username || address.password)
      throw new Error("Invalid artifact service URL.");
    const response = await fetcher(address, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(120000),
    });
    if (!response.ok) throw new Error(`Artifact service HTTP ${response.status}.`);
    return response;
  };
  const rpc = async (method, body) => {
    const payload = { ...base, ...body };
    if (method === "ListArtifacts") delete payload.name;
    return (
      await send(
        new URL(
          `twirp/github.actions.results.api.v1.ArtifactService/${method}`,
          results.endsWith("/") ? results : `${results}/`,
        ),
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      )
    ).json();
  };
  const existing = await rpc("ListArtifacts", { name_filter: artifactName });
  if (existing.artifacts?.some((artifact) => artifact.name === artifactName))
    throw new Error("CI artifact already exists; it will not be overwritten.");
  const created = await rpc("CreateArtifact", {
    version: 4,
    expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
  });
  if (!created.ok || !created.signedUploadUrl)
    throw new Error("Artifact creation was not confirmed.");
  const block = Buffer.from("00000000").toString("base64");
  const put = async (comp, body, blockid) => {
    const url = new URL(created.signedUploadUrl);
    url.searchParams.set("comp", comp);
    if (blockid) url.searchParams.set("blockid", blockid);
    // Signed upload URLs never receive the runtime bearer token.
    await send(url, {
      method: "PUT",
      headers: {
        "Content-Type": comp === "blocklist" ? "application/xml" : "application/octet-stream",
      },
      body,
    });
  };
  await put("block", bytes, block);
  await put("blocklist", `<BlockList><Latest>${block}</Latest></BlockList>`);
  const hash = digest(bytes);
  const finalized = await rpc("FinalizeArtifact", {
    size: String(bytes.length),
    hash: `sha256:${hash}`,
  });
  if (!finalized.ok || !finalized.artifactId)
    throw new Error("Artifact finalization was not confirmed.");
  const signed = await rpc("GetSignedArtifactURL", {});
  if (!signed.signedUrl) throw new Error("Artifact download unavailable after finalization.");
  const downloaded = Buffer.from(
    await (await send(signed.signedUrl, { method: "GET" })).arrayBuffer(),
  );
  if (downloaded.length !== bytes.length || digest(downloaded) !== hash)
    throw new Error("Uploaded artifact download does not match its checksum.");
  return {
    name: artifactName,
    id: finalized.artifactId,
    bytes: bytes.length,
    sha256: hash,
    downloadVerified: true,
  };
}

export async function retainCandidates({ name, targets = [] }) {
  const version = JSON.parse(readFileSync("package.json", "utf8")).version;
  const files = [];
  for (const target of targets) {
    const file = widgetName(version, target);
    for (const path of [file, `${file}.sha256`])
      files.push({ name: path, data: readFileSync(resolve("build", path)) });
  }
  for (const file of readdirSync("build/candidate-evidence")) {
    if (
      /^[\d.]+-(?:syntax|startup|engine)(?:-[\d.]+)?\.json$/.test(file) ||
      /^vod-[\d.]+-(?:[\d.]+|desktop)-(?:en|sv|ar)-(?:home|loading|grid|empty|failure|movie-detail|stale|list|episodes|episode-list)\.png$/.test(
        file,
      ) ||
      /^vod-windowing-[\d.]+-(?:[\d.]+|desktop)-(?:10000|20000)-(?:en|sv|ar)\.json$/.test(file)
    )
      files.push({
        name: `candidate-evidence/${file}`,
        data: readFileSync(resolve("build/candidate-evidence", file)),
      });
  }
  if (!files.length) throw new Error("No candidate evidence to retain.");
  const bytes = createZip(
    files.map((file) => ({ ...file, mtime: new Date("2026-01-01T00:00:00Z"), utc: true })),
  );
  return uploadArtifact({ name, bytes });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const arg = (key) =>
      process.argv.find((value) => value.startsWith(`--${key}=`))?.slice(key.length + 3);
    console.log(
      JSON.stringify(
        await retainCandidates({
          name: arg("name"),
          targets: arg("targets")?.split(",") ?? [],
        }),
      ),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
