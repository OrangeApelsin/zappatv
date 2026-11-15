import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build, createLogger } from "vite";
import { checkArtifacts } from "./check-artifacts.mjs";

/** Keep Vite's diagnostics visible, but never accept a warning-bearing artifact. */
export async function buildWithWarningsAsErrors(options = {}) {
  const logger = createLogger(options.logLevel);
  const result = await build({ ...options, customLogger: logger });
  if (logger.hasWarned) {
    throw new Error("Build emitted warnings; resolve them before shipping the artifact.");
  }
  return result;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    await buildWithWarningsAsErrors();
    const result = checkArtifacts({ target: process.env.TIZEN_TARGET ?? "5.5" });
    console.log(
      `Classic artifact syntax: Tizen ${result.target}, ${result.scripts.length} scripts passed.`,
    );
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
