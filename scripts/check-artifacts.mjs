import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse } from "acorn";
import { JSDOM } from "jsdom";
import { targetPolicy } from "./tv/platforms.mjs";

// Era-level grammar ceilings, not exact engine support or API compatibility.
// Actual representative-engine/widget-origin execution is a separate release gate.
export function checkArtifacts({ root = resolve("dist"), target = "5.5" } = {}) {
  const grammar = targetPolicy(target).package.grammar;
  root = resolve(root);
  const scripts = [];
  const platformScripts = [];
  const check = (code, path) => {
    if (code.includes("__ZAPPA_TV_PREVIEW__"))
      throw new Error(`Production artifact contains the preview simulation: ${path}`);
    try {
      parse(code, { ecmaVersion: grammar, sourceType: "script" });
    } catch (error) {
      throw new Error(`Tizen ${target} classic syntax failed in ${path}: ${error.message}`);
    }
    scripts.push({
      path,
      bytes: Buffer.byteLength(code),
      sha256: createHash("sha256").update(code).digest("hex"),
    });
  };
  const dom = new JSDOM(readFileSync(resolve(root, "index.html"), "utf8"));
  try {
    const nodes = [...dom.window.document.querySelectorAll("script")];
    if (!nodes.length) throw new Error("Artifact has no startup scripts.");
    for (const [index, script] of nodes.entries()) {
      if (script.type && !["text/javascript", "application/javascript"].includes(script.type))
        throw new Error("Widget startup must use classic scripts.");
      if (!script.src) {
        check(script.textContent, `inline-${index}`);
        continue;
      }
      const src = script.getAttribute("src");
      // Samsung resolves this exact system resource inside a widget. It is not
      // a packaged file; do not generalize the exception to external scripts.
      if (src === "$WEBAPIS/webapis/webapis.js") {
        if (platformScripts.length) throw new Error("Duplicate Samsung WebAPI loader.");
        platformScripts.push(src);
        continue;
      }
      if (/^[a-z][\w+.-]*:|^[\\/]/i.test(src))
        throw new Error("Widget startup must use packaged relative script URLs.");
      const url = new URL(src, pathToFileURL(resolve(root, "index.html")));
      if (url.protocol !== "file:" || url.search || url.hash)
        throw new Error("Widget startup must use packaged relative script URLs.");
      const path = fileURLToPath(url);
      const rel = relative(root, path);
      if (isAbsolute(rel) || rel === ".." || rel.startsWith("..\\") || rel.startsWith("../"))
        throw new Error("Startup script escapes the widget directory.");
      check(readFileSync(path, "utf8"), rel.replaceAll("\\", "/"));
    }
  } finally {
    dom.window.close();
  }
  const workers = readdirSync(resolve(root, "assets")).filter((name) =>
    /^vodWorker-.*\.js$/.test(name),
  );
  if (workers.length !== 1) throw new Error("Expected exactly one packaged VOD worker.");
  const worker = `assets/${workers[0]}`;
  check(readFileSync(resolve(root, worker), "utf8"), worker);
  return { target, grammar, scripts, platformScripts, worker };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const arg = (key) =>
      process.argv.find((value) => value.startsWith(`--${key}=`))?.slice(key.length + 3);
    const result = checkArtifacts({
      root: resolve(arg("dir") ?? "dist"),
      target: arg("target") ?? process.env.TIZEN_TARGET ?? "5.5",
    });
    console.log(
      `Classic artifact syntax passed: Tizen ${result.target}, ${result.scripts.length} scripts; target-engine/API execution still required.`,
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
