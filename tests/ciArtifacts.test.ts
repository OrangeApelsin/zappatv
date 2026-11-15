// @vitest-environment node
import { expect, test, vi } from "vitest";
import { uploadArtifact } from "../scripts/ci-artifacts.mjs";
const env = {
  ACTIONS_RUNTIME_TOKEN: `x.${Buffer.from(JSON.stringify({ scp: "Actions.Results:7:9" })).toString("base64url")}.x`,
  ACTIONS_RESULTS_URL: "https://gitea.invalid/api/actions_pipeline/",
};

function service(bytes: Buffer, corrupt = false) {
  return vi.fn(async (url: URL, init: RequestInit) => {
    const path = url.pathname;
    if (path.endsWith("ListArtifacts")) return Response.json({ artifacts: [] });
    if (path.endsWith("CreateArtifact"))
      return Response.json({
        ok: true,
        signedUploadUrl: "https://storage.invalid/upload?sig=private",
      });
    if (path.endsWith("FinalizeArtifact")) return Response.json({ ok: true, artifactId: "17" });
    if (path.endsWith("GetSignedArtifactURL"))
      return Response.json({ signedUrl: "https://storage.invalid/download?sig=private" });
    if (init.method === "GET") return new Response(corrupt ? Buffer.from("wrong") : bytes);
    return new Response(null, { status: 201 });
  });
}

test("native Gitea artifact upload verifies downloaded bytes without sending bearer tokens to signed storage", async () => {
  const bytes = Buffer.from("archive fixture");
  const fetcher = service(bytes);
  const result = await uploadArtifact({ name: "candidate-fixture", bytes, env, fetcher });
  expect(result).toMatchObject({ id: "17", downloadVerified: true, bytes: bytes.length });
  expect(fetcher).toHaveBeenCalledTimes(7);
  for (const [url, init] of fetcher.mock.calls) {
    expect(init.redirect).toBe("error");
    if (url.hostname === "storage.invalid")
      expect(init.headers ?? {}).not.toHaveProperty("Authorization");
    else {
      expect(init.headers).toHaveProperty(
        "Authorization",
        `Bearer ${env.ACTIONS_RUNTIME_TOKEN}`,
      );
      expect(JSON.parse(init.body as string)).toMatchObject({
        workflow_run_backend_id: "7",
        workflow_job_run_backend_id: "9",
      });
    }
  }
  expect(fetcher.mock.calls[2][0].searchParams.get("comp")).toBe("block");
  expect(fetcher.mock.calls[3][0].searchParams.get("comp")).toBe("blocklist");
});

test("an incomplete upload cannot finalize or report a verified artifact", async () => {
  const fetcher = service(Buffer.from("fixture"));
  fetcher.mockImplementationOnce(async () => Response.json({ artifacts: [] }));
  fetcher.mockImplementationOnce(async () =>
    Response.json({ ok: true, signedUploadUrl: "https://storage.invalid/upload" }),
  );
  fetcher.mockImplementationOnce(async () => new Response(null, { status: 500 }));
  await expect(
    uploadArtifact({ name: "fixture", bytes: Buffer.from("fixture"), env, fetcher }),
  ).rejects.toThrow("HTTP 500");
  expect(fetcher).toHaveBeenCalledTimes(3);
});

test("a corrupt download or missing runtime scope remains a failure", async () => {
  const bytes = Buffer.from("fixture");
  await expect(
    uploadArtifact({ name: "fixture", bytes, env, fetcher: service(bytes, true) }),
  ).rejects.toThrow("checksum");
  await expect(uploadArtifact({ name: "fixture", bytes, env: {} })).rejects.toThrow(
    "credentials",
  );
});

test("existing artifacts are never overwritten even if a job step is repeated", async () => {
  const bytes = Buffer.from("fixture");
  const fetcher = vi.fn(async () => Response.json({ artifacts: [{ name: "fixture-9" }] }));
  await expect(uploadArtifact({ name: "fixture", bytes, env, fetcher })).rejects.toThrow(
    "not be overwritten",
  );
  expect(fetcher).toHaveBeenCalledOnce();
});
