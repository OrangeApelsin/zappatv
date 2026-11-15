#!/usr/bin/env node
/**
 * Package dist/ into an unsigned, versioned Tizen/W3C widget archive.
 *
 * A Tizen .wgt file is a standard ZIP archive (PKZip 2.0) containing the widget
 * root (config.xml, index.html, icon.png, assets, etc.).
 *
 * This script runs cross-platform on Node 22+ with zero external dependencies,
 * Apps2Samsung handles device signing. SOURCE_DATE_EPOCH makes approved candidate
 * bytes reproducible across builds, file mtimes and host timezones.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";
import {
  widgetMetadata,
  stampVersion,
  stampRequiredVersion,
  sha256 as digest,
  checksumText,
} from "./widget-metadata.mjs";
export { stampVersion, stampRequiredVersion } from "./widget-metadata.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const makeCrcTable = () => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
};

const crcTable = makeCrcTable();

export function computeCrc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function dosDateTime(date = new Date(), utc = false) {
  const hours = utc ? date.getUTCHours() : date.getHours();
  const minutes = utc ? date.getUTCMinutes() : date.getMinutes();
  const seconds = utc ? date.getUTCSeconds() : date.getSeconds();
  const year = utc ? date.getUTCFullYear() : date.getFullYear();
  const month = utc ? date.getUTCMonth() : date.getMonth();
  const day = utc ? date.getUTCDate() : date.getDate();
  const time =
    ((hours & 0x1f) << 11) | ((minutes & 0x3f) << 5) | (Math.floor(seconds / 2) & 0x1f);
  const d = (((year - 1980) & 0x7f) << 9) | (((month + 1) & 0x0f) << 5) | (day & 0x1f);
  return { time, date: d };
}

export function createZip(entries) {
  const localHeaders = [];
  const centralHeaders = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name.replace(/\\/g, "/"), "utf8");
    const rawData = entry.data;
    const crc = computeCrc32(rawData);
    const uncompressedSize = rawData.length;

    let deflated = null;
    if (uncompressedSize > 0) {
      deflated = deflateRawSync(rawData);
    }

    const useDeflate = deflated && deflated.length < uncompressedSize;
    const method = useDeflate ? 8 : 0;
    const compressedData = useDeflate ? deflated : rawData;
    const compressedSize = compressedData.length;

    const { time, date } = dosDateTime(entry.mtime || new Date(), entry.utc);

    const localHeader = Buffer.alloc(30 + nameBuf.length);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(time, 10);
    localHeader.writeUInt16LE(date, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressedSize, 18);
    localHeader.writeUInt32LE(uncompressedSize, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);
    nameBuf.copy(localHeader, 30);

    localHeaders.push(localHeader, compressedData);

    const centralHeader = Buffer.alloc(46 + nameBuf.length);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(0x0314, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(time, 12);
    centralHeader.writeUInt16LE(date, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressedSize, 20);
    centralHeader.writeUInt32LE(uncompressedSize, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    nameBuf.copy(centralHeader, 46);

    centralHeaders.push(centralHeader);

    offset += localHeader.length + compressedData.length;
  }

  const centralDirOffset = offset;
  const centralDirBuffer = Buffer.concat(centralHeaders);
  const centralDirSize = centralDirBuffer.length;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirSize, 12);
  eocd.writeUInt32LE(centralDirOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localHeaders, centralDirBuffer, eocd]);
}

export function collectFiles(dir, baseDir = dir) {
  const entries = [];
  const items = readdirSync(dir, { withFileTypes: true });

  items.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  for (const item of items) {
    const fullPath = join(dir, item.name);
    if (item.isDirectory()) {
      entries.push(...collectFiles(fullPath, baseDir));
    } else if (item.isFile()) {
      const relPath = relative(baseDir, fullPath).replace(/\\/g, "/");
      const stat = statSync(fullPath);
      const data = readFileSync(fullPath);
      entries.push({
        name: relPath,
        data,
        mtime: stat.mtime,
      });
    }
  }
  return entries;
}

export function packageWidget(options = {}) {
  const distDir = options.distDir || resolve(ROOT, "dist");
  const buildDir = options.buildDir || resolve(ROOT, "build");

  if (!existsSync(distDir)) {
    throw new Error(`Build directory "${distDir}" does not exist. Run "npm run build" first.`);
  }

  const configPath = join(distDir, "config.xml");
  if (!existsSync(configPath)) {
    throw new Error(`Widget manifest missing at "${configPath}". Run "npm run build" first.`);
  }

  const meta = widgetMetadata({
    target: options.target || process.env.TIZEN_TARGET || "5.5",
    version: options.version,
  });
  const { target, version } = meta;
  const outName = options.outName || meta.name;
  if (outName !== meta.name)
    throw new Error("Output name must match the selected version and target.");
  const builtPath = join(distDir, "build-target.json");
  if (existsSync(builtPath)) {
    const built = JSON.parse(readFileSync(builtPath, "utf8"));
    if (built.target !== target || built.version !== version)
      throw new Error(
        "Rebuild for the selected target/version; stamping cannot change compiled identity.",
      );
  }
  stampVersion(configPath, version);
  stampRequiredVersion(configPath, target);

  const files = collectFiles(distDir);
  const epoch = options.sourceDateEpoch ?? process.env.SOURCE_DATE_EPOCH;
  if (epoch !== undefined) {
    const seconds = Number(epoch);
    const timestamp = new Date(Math.max(seconds, 315532800) * 1000);
    if (
      !/^\d+$/.test(String(epoch)) ||
      !Number.isSafeInteger(seconds) ||
      !Number.isFinite(timestamp.getTime()) ||
      timestamp.getUTCFullYear() > 2107
    ) {
      throw new Error(
        "SOURCE_DATE_EPOCH must be a nonnegative integer representable by ZIP timestamps.",
      );
    }
    for (const file of files) {
      file.mtime = timestamp;
      file.utc = true;
      // Git autocrlf and copied public files must not change candidate bytes.
      // Normalize valid UTF-8 web text only; binary payloads remain untouched.
      if (/\.(?:css|html|js|json|md|svg|txt|xml)$/i.test(file.name)) {
        const decoded = file.data.toString("utf8");
        if (Buffer.from(decoded, "utf8").equals(file.data))
          file.data = Buffer.from(decoded.replace(/\r+\n/g, "\n"), "utf8");
      }
    }
  }
  if (!files.some((f) => f.name === "config.xml")) {
    throw new Error("config.xml is missing from widget payload.");
  }
  if (!files.some((f) => f.name === "index.html")) {
    throw new Error("index.html is missing from widget payload.");
  }

  const zipBuf = createZip(files);

  if (!existsSync(buildDir)) {
    mkdirSync(buildDir, { recursive: true });
  }

  // Strictly write only the version-stamped package and its checksum
  const wgtPath = join(buildDir, outName);
  writeFileSync(wgtPath, zipBuf);

  const sha256 = digest(zipBuf);
  writeFileSync(join(buildDir, `${outName}.sha256`), checksumText(sha256, outName));

  return {
    path: wgtPath,
    name: outName,
    bytes: zipBuf.length,
    filesCount: files.length,
    sha256,
    version,
    target: target || "5.5",
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const targetArg = process.argv.find((a) => a.startsWith("--target="));
    const target = targetArg ? targetArg.split("=")[1] : process.env.TIZEN_TARGET;
    const nameArg = process.argv.find((a) => a.startsWith("--name=") || a.startsWith("--out="));
    const outName = nameArg ? nameArg.split("=")[1] : undefined;

    const res = packageWidget({ target, outName });
    const kb = (res.bytes / 1024).toFixed(1);
    console.log("\nPackaged Zappa 2 Widget (Versioned):");
    console.log(`  File:        build/${res.name} (${kb} KB, ${res.filesCount} files)`);
    console.log(`  Target:      Tizen ${res.target}`);
    console.log(`  Version:     ${res.version}`);
    console.log(`  SHA-256:     ${res.sha256}`);
    console.log("\nUnsigned widget: use Apps2Samsung automatic signing for installation.\n");
  } catch (err) {
    console.error(`Error packaging widget: ${err.message}`);
    process.exit(1);
  }
}
