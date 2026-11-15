import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, test } from "vitest";
import { buildWithWarningsAsErrors } from "../scripts/build.mjs";

const fixtures: string[] = [];
const fixture = () => {
  const directory = mkdtempSync(join(tmpdir(), "zappa-tooling-"));
  fixtures.push(directory);
  return directory;
};

afterEach(() => {
  for (const directory of fixtures.splice(0)) rmSync(directory, { recursive: true, force: true });
});

test("the configured lint command rejects a warning-only fixture", () => {
  const directory = fixture();
  writeFileSync(
    join(directory, "biome.json"),
    JSON.stringify({
      linter: {
        rules: { recommended: false, complexity: { useOptionalChain: "warn" } },
      },
    }),
  );
  writeFileSync(join(directory, "warning.js"), "export function read(v) { return v && v.name; }\n");
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const args = pkg.scripts.lint.split(/\s+/).slice(1);
  const command = (options: string[]) =>
    spawnSync(
      process.execPath,
      [resolve("node_modules/@biomejs/biome/bin/biome"), ...options, "warning.js"],
      { cwd: directory, encoding: "utf8" },
    );

  // The identical fixture passes without strict warnings, so a syntax error or an
  // unavailable binary cannot masquerade as proof that the warning gate works.
  const relaxed = command(args.filter((arg: string) => arg !== "--error-on-warnings"));
  expect(relaxed.error).toBeUndefined();
  expect(relaxed.status).toBe(0);
  expect(`${relaxed.stdout}${relaxed.stderr}`).toContain("useOptionalChain");
  const strict = command(args);
  expect(strict.error).toBeUndefined();
  expect(strict.status).not.toBe(0);
});

test("production builds reject a real bundler warning and accept clean input", async () => {
  const directory = fixture();
  writeFileSync(join(directory, "index.html"), '<script type="module" src="/main.js"></script>');
  writeFileSync(join(directory, "main.js"), "document.title = 'fixture';\n");
  const options = {
    root: directory,
    configFile: false as const,
    // Only this synthetic test fixture is quiet; the production command retains
    // Vite's normal output. Its logger still records warnings at silent level.
    logLevel: "silent" as const,
    build: { write: false, minify: false as const },
  };
  await expect(
    buildWithWarningsAsErrors({
      ...options,
      plugins: [
        {
          name: "warning-fixture",
          buildStart() {
            this.warn("deliberate build policy regression fixture");
          },
        },
      ],
    }),
  ).rejects.toThrow("Build emitted warnings");
  await expect(buildWithWarningsAsErrors(options)).resolves.toBeDefined();
});
