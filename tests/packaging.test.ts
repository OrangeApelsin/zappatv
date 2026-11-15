import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  utimesSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "vitest";
import {
  computeCrc32,
  createZip,
  dosDateTime,
  packageWidget,
  stampVersion,
} from "../scripts/package-wgt.mjs";

test("approved widget bytes ignore filesystem mtimes and use explicit UTC ZIP time", () => {
  const root = mkdtempSync(join(tmpdir(), "zappa-reproducible-"));
  const distDir = join(root, "dist");
  mkdirSync(distDir);
  writeFileSync(
    join(distDir, "config.xml"),
    '<widget version="1.0.0"><tizen:application required_version="5.0" /></widget>',
  );
  writeFileSync(join(distDir, "index.html"), "fixture\r\r\n");
  writeFileSync(join(distDir, "THIRD-PARTY-NOTICES.md"), "licence\r\n");
  writeFileSync(join(distDir, "icon.png"), Buffer.from([0, 13, 10, 255]));
  try {
    const options = { distDir, buildDir: join(root, "build"), sourceDateEpoch: 1794139200 };
    const first = packageWidget(options);
    const bytes = readFileSync(first.path);
    for (const name of ["config.xml", "index.html", "icon.png"]) {
      utimesSync(
        join(distDir, name),
        new Date("2000-01-01T00:00:00Z"),
        new Date("2000-01-01T00:00:00Z"),
      );
    }
    writeFileSync(join(distDir, "index.html"), "fixture\n");
    writeFileSync(join(distDir, "THIRD-PARTY-NOTICES.md"), "licence\n");
    assert.ok(bytes.equals(readFileSync(packageWidget(options).path)));
    const moduleUrl = pathToFileURL(join(process.cwd(), "scripts/package-wgt.mjs")).href;
    const code = `import {packageWidget} from ${JSON.stringify(moduleUrl)}; console.log(packageWidget(${JSON.stringify(options)}).sha256);`;
    const hashes = ["Pacific/Honolulu", "Europe/Stockholm"].map((TZ) =>
      execFileSync(process.execPath, ["--input-type=module", "-e", code], {
        encoding: "utf8",
        env: { ...process.env, TZ },
      }).trim(),
    );
    assert.equal(hashes[0], hashes[1]);
    const time = dosDateTime(new Date("2026-11-08T12:34:56Z"), true);
    assert.equal(time.time, (12 << 11) | (34 << 5) | 28);
    assert.throws(
      () => packageWidget({ ...options, sourceDateEpoch: "not-a-date" }),
      /SOURCE_DATE_EPOCH/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("config.xml contains required Zappa TV widget metadata and privileges", () => {
  const xml = readFileSync(join(process.cwd(), "public/config.xml"), "utf8");

  // Manifest identity and application ID
  assert.match(xml, /<widget\b[^>]*\bid="http:\/\/zappa\.local\/ZappaTV"/);
  assert.match(xml, /<name>Zappa TV<\/name>/);
  assert.match(
    xml,
    /<tizen:application\b[^>]*\bid="ZappaTV002\.ZappaTV"\s+package="ZappaTV002"/,
  );

  // Resolution and required profile
  assert.match(xml, /screen\.size\.normal\.1080\.1920/);
  assert.match(xml, /<tizen:profile name="tv-samsung"\s*\/>/);

  // Hardware AVPlay and input privileges
  assert.match(xml, /privilege\/internet/);
  assert.match(xml, /privilege\/network\.public/);
  assert.match(xml, /privilege\/avplay/);
  assert.match(xml, /privilege\/tv\.inputdevice/);
  assert.match(xml, /privilege\/tv\.audio/);

  // Content security policy: loopback wasm and hardware video surface
  assert.match(xml, /unsafe-eval/);
  assert.match(xml, /object-src 'self'/);
});

test("target selection rejects duplicate or unknown targets before building", () => {
  for (const targets of ["5.0,5.0", "unknown", ""]) {
    assert.throws(
      () =>
        execFileSync(process.execPath, ["scripts/build-all.mjs"], {
          cwd: process.cwd(),
          env: { ...process.env, TIZEN_TARGETS: targets },
          stdio: "pipe",
        }),
      /unknown, empty or duplicate/,
    );
  }
});

test("computeCrc32 produces standard IEEE 802.3 checksums", () => {
  assert.equal(computeCrc32(Buffer.from("")), 0);
  // Standard test vector: "123456789" -> 0xcbf43926 (3421780262)
  assert.equal(computeCrc32(Buffer.from("123456789", "utf8")), 0xcbf43926);
});

test("dosDateTime correctly converts date and time to MS-DOS format", () => {
  const testDate = new Date(2026, 10, 7, 12, 30, 40); // 2026-11-07 12:30:40
  const { time, date } = dosDateTime(testDate);
  assert.ok(time > 0);
  assert.ok(date > 0);
  assert.equal((date >> 9) + 1980, 2026);
  assert.equal((date >> 5) & 0x0f, 11);
  assert.equal(date & 0x1f, 7);
});

test("createZip produces a valid PKZip archive with correct local and central headers", () => {
  const fileA = Buffer.from("Hello Zappa TV", "utf8");
  const fileB = Buffer.from("Config XML Mock Content", "utf8");

  const zipBuf = createZip([
    { name: "hello.txt", data: fileA },
    { name: "sub/config.xml", data: fileB },
  ]);

  // Magic numbers
  assert.equal(zipBuf.readUInt32LE(0), 0x04034b50, "Local header signature PK\\x03\\x04");

  // End of Central Directory magic number
  const eocdOffset = zipBuf.length - 22;
  assert.equal(zipBuf.readUInt32LE(eocdOffset), 0x06054b50, "EOCD signature PK\\x05\\x06");
  assert.equal(zipBuf.readUInt16LE(eocdOffset + 8), 2, "Total entries count");
  assert.equal(zipBuf.readUInt16LE(eocdOffset + 10), 2, "Total entries count");
});

test("packageWidget creates strictly versioned zappa wgt with stamped config.xml and valid SHA-256", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "zappa-test-"));
  const distDir = join(tempDir, "dist");
  const buildDir = join(tempDir, "build");

  mkdirSync(distDir, { recursive: true });
  mkdirSync(buildDir, { recursive: true });

  try {
    writeFileSync(
      join(distDir, "config.xml"),
      '<widget xmlns="http://www.w3.org/ns/widgets" id="test" version="1.0.0"><tizen:application id="test" required_version="2.3" /></widget>',
    );
    writeFileSync(join(distDir, "index.html"), "<!doctype html><html></html>");
    writeFileSync(join(distDir, "icon.png"), Buffer.alloc(16));

    const result = packageWidget({ distDir, buildDir });

    assert.equal(result.filesCount, 3);
    assert.ok(result.bytes > 100);
    assert.match(result.sha256, /^[a-f0-9]{64}$/);
    assert.equal(result.name, `zappa-${result.version}.wgt`);
    assert.ok(existsSync(join(buildDir, `zappa-${result.version}.wgt`)));
    assert.ok(existsSync(join(buildDir, `zappa-${result.version}.wgt.sha256`)));

    // Unversioned aliases must NOT be created
    assert.ok(!existsSync(join(buildDir, "zappa.wgt")));
    assert.ok(!existsSync(join(buildDir, "zappa.wgt.sha256")));
    assert.ok(!existsSync(join(buildDir, "zappa2.wgt")));

    // Verify version & required_version stamping
    const stampedXml = readFileSync(join(distDir, "config.xml"), "utf8");
    assert.match(stampedXml, new RegExp(`version="${result.version}"`));
    assert.match(stampedXml, /required_version="5\.5"/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("packageWidget creates target-specific versioned wgt names and stamps required_version", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "zappa-target-"));
  const distDir = join(tempDir, "dist");
  const buildDir = join(tempDir, "build");

  mkdirSync(distDir, { recursive: true });
  mkdirSync(buildDir, { recursive: true });

  try {
    writeFileSync(
      join(distDir, "config.xml"),
      '<widget xmlns="http://www.w3.org/ns/widgets" id="test" version="1.0.0"><tizen:application id="test" required_version="2.3" /></widget>',
    );
    writeFileSync(join(distDir, "index.html"), "<!doctype html><html></html>");
    writeFileSync(join(distDir, "icon.png"), Buffer.alloc(16));

    const result3 = packageWidget({ distDir, buildDir, target: "3.0" });
    assert.equal(result3.name, `zappa-${result3.version}-tizen3.wgt`);
    assert.ok(existsSync(join(buildDir, `zappa-${result3.version}-tizen3.wgt`)));
    assert.ok(!existsSync(join(buildDir, "zappa-tizen3.wgt")));
    const xml3 = readFileSync(join(distDir, "config.xml"), "utf8");
    assert.match(xml3, /required_version="3\.0"/);

    const result4 = packageWidget({ distDir, buildDir, target: "4.0" });
    assert.equal(result4.name, `zappa-${result4.version}-tizen4.wgt`);
    assert.ok(existsSync(join(buildDir, `zappa-${result4.version}-tizen4.wgt`)));
    const xml4 = readFileSync(join(distDir, "config.xml"), "utf8");
    assert.match(xml4, /required_version="4\.0"/);

    const result5 = packageWidget({ distDir, buildDir, target: "5.0" });
    assert.equal(result5.name, `zappa-${result5.version}-tizen5.wgt`);
    assert.ok(existsSync(join(buildDir, `zappa-${result5.version}-tizen5.wgt`)));
    const xml5 = readFileSync(join(distDir, "config.xml"), "utf8");
    assert.match(xml5, /required_version="5\.0"/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("stampVersion handles valid and untouched manifests gracefully", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "zappa-stamp-"));
  const configPath = join(tempDir, "config.xml");
  try {
    writeFileSync(configPath, '<widget id="x" version="1.0.0"></widget>');
    stampVersion(configPath, "2.5.0");
    const stamped = readFileSync(configPath, "utf8");
    assert.equal(stamped, '<widget id="x" version="2.5.0"></widget>');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
