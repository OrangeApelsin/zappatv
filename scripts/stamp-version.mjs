#!/usr/bin/env node
import { stampVersion } from "./widget-metadata.mjs";
const [file, version] = process.argv.slice(2);
try {
  if (!file || !version) throw new Error("usage: stamp-version.mjs <config.xml> <version>");
  stampVersion(file, version);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
