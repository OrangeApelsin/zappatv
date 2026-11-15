import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";

describe("Aqua Translucent Flagship Theme (TICKET-801)", () => {
  const tokensCss = readFileSync("src/styles/tokens.css", "utf8");

  test("defines deep oceanic background colors", () => {
    expect(tokensCss).toContain("--bg: #0a0c0f;");
    expect(tokensCss).toContain("--bg-2: #0f131a;");
    expect(tokensCss).toContain("--bg-3: #161a23;");
  });

  test("defines frosted glass translucent overlays", () => {
    expect(tokensCss).toContain("--surface-1: rgba(15, 19, 26, 0.88);");
    expect(tokensCss).toContain("--surface-2: rgba(22, 26, 35, 0.92);");
    expect(tokensCss).toContain("--surface-3: rgba(30, 36, 48, 0.94);");
    expect(tokensCss).toContain("--over-video: rgba(10, 12, 15, 0.90);");
  });

  test("defines electric blue accents, neon glow, and secondary hue", () => {
    expect(tokensCss).toContain("--accent: #4c8dff;");
    expect(tokensCss).toContain("--accent-dim: #1f3a66;");
    expect(tokensCss).toContain("--accent-wash: rgba(76, 141, 255, 0.22);");
    expect(tokensCss).toContain("--glow: rgba(76, 141, 255, 0.12);");
    expect(tokensCss).toContain("--hue2: #8c5cff;");
  });

  test("defines inverted solid light focus with hairline border lift", () => {
    expect(tokensCss).toContain("--focus: #ffffff;");
    expect(tokensCss).toContain("--on-focus: #0a0c0f;");
    expect(tokensCss).toContain("inset 0 0 0 1px rgba(76, 141, 255, 0.16)");
  });
});
