/// <reference types="vitest/config" />

import { readFileSync } from "node:fs";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { devRemoteBridge } from "./scripts/dev-remote-bridge.mjs";
import { handleHttpRelay } from "./scripts/http-relay.mjs";
import { targetPolicy } from "./scripts/tv/platforms.mjs";

const pkg = JSON.parse(readFileSync("./package.json", "utf8"));

const TARGET = process.env.TIZEN_TARGET || "5.5";

const policy = targetPolicy(TARGET);
const currentConfig = {
  buildTarget: `chrome${policy.chromium}`,
  cssTarget: `chrome${policy.chromium}`,
  injectCssVars: policy.package.injectCssVars,
};

/**
 * Tizen Smart TVs load the packaged widget directly from the local filesystem
 * (file:///opt/usr/apps/.../res/wgt/index.html).
 *
 * In older Chromium engines (such as Chromium 63 on Tizen 5.0 and Chromium 69 on Tizen 5.5),
 * module scripts (<script type="module">) strictly require a valid JavaScript MIME type.
 * Because the local file:// protocol does not return HTTP headers (MIME type of ""),
 * the browser rejects module scripts with:
 * "Failed to load module script: The server responded with a non-JavaScript MIME type of \"\"."
 *
 * Classic scripts (<script defer src="...">) do not enforce MIME type checks on file://,
 * and do not trigger CORS restrictions when crossorigin is removed.
 *
 * Rolldown emits the actual classic/IIFE code. This plugin only adapts HTML
 * loading attributes; it must never rewrite JavaScript or remove exports by regex.
 */
function tizenClassicScript(): Plugin {
  return {
    name: "tizen-classic-script",
    apply: "build",
    enforce: "post",
    transformIndexHtml(html: string) {
      let transformed = html
        .replace(
          /<script\s+type="module"\s+(?:crossorigin\s+)?src="([^"]+)"><\/script>/gi,
          '<script defer src="$1"></script>',
        )
        .replace(/\s+type="module"/gi, "")
        .replace(/\s+crossorigin(?:="[^"]*")?/gi, "")
        .replace(/<link\s+rel="modulepreload"[^>]*>/gi, "");

      if (currentConfig.injectCssVars) {
        transformed = transformed.replace(
          "</head>",
          '  <script src="./legacy/cssvars.js"></script>\n  </head>',
        );
      }
      return transformed;
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    tizenClassicScript(),
    {
      name: "widget-target-policy",
      apply: "build",
      generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: "build-target.json",
          source: JSON.stringify({
            target: policy.tizen,
            chromium: policy.chromium,
            experimental: policy.package.experimental,
            version: pkg.version,
          }),
        });
      },
    },
    devRemoteBridge(),
    {
      name: "openiptv-http-relay",
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          if (!handleHttpRelay(request, response)) next();
        });
      },
      configurePreviewServer(server) {
        server.middlewares.use((request, response, next) => {
          if (!handleHttpRelay(request, response)) next();
        });
      },
    },
  ],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  // The TV loads the app from the filesystem inside the widget, so every asset
  // reference has to be relative. An absolute /assets/... path resolves to the
  // device root and 404s.
  base: "./",
  worker: { format: "iife" },
  // Downlevel the shipped artifact through build.target. Applying a TV target to
  // test transforms also lowers mock factories and introduces helpers before
  // Vitest's hoisted imports are initialized; the host tests run on pinned Node.
  build: {
    outDir: "dist",
    cssCodeSplit: false,
    rolldownOptions: { output: { format: "iife", codeSplitting: false } },
    modulePreload: false,
    target: currentConfig.buildTarget,
    cssTarget: currentConfig.cssTarget,
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1500,
  },
  server: { port: 5173, host: true },

  /*
   * Tests run through Vite rather than through node --test.
   *
   * The previous arrangement leaned on Node's own type stripping and on Node resolving the
   * imports, and the second of those quietly decided what could be tested at all: everything
   * under src/ imports its neighbours without a file extension, which Node's ESM resolver
   * refuses, so only modules whose every relative import was a type import could be loaded.
   * The four that had tests qualified by luck rather than by design, and player.ts, the
   * stores and the logo cache could not have been tested without rewriting their imports.
   *
   * Vite resolves the same way the application does, so a test can import anything the app
   * can. jsdom is there for the modules that touch the document, which on a browser and a
   * television is most of the interesting ones.
   */
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    setupFiles: ["tests/setup.ts"],
    restoreMocks: true,
  },
});
