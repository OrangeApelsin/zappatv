import { WIDGET_IDENTITY } from "./widget-metadata.mjs";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { checkArtifacts } from "./check-artifacts.mjs";
import { targetPolicy } from "./tv/platforms.mjs";

/** Validate the actual extracted package, independently of its filename/build env. */
export function checkWidget({ root, target, version }) {
  const policy = targetPolicy(target);
  const built = JSON.parse(readFileSync(resolve(root, "build-target.json"), "utf8"));
  if (
    built.target !== target ||
    built.chromium !== policy.chromium ||
    built.experimental !== policy.package.experimental ||
    built.version !== version
  )
    throw new Error("Built target policy does not match the widget declaration.");
  const dom = new JSDOM(readFileSync(resolve(root, "config.xml"), "utf8"), {
    contentType: "application/xml",
  });
  try {
    const document = dom.window.document;
    const widget = document.documentElement;
    const app = document.getElementsByTagNameNS(
      "http://tizen.org/ns/widgets",
      "application",
    )[0];
    if (
      widget.localName !== "widget" ||
      widget.getAttribute("id") !== WIDGET_IDENTITY.widget ||
      widget.getAttribute("version") !== version ||
      app?.getAttribute("id") !== WIDGET_IDENTITY.application ||
      app?.getAttribute("package") !== WIDGET_IDENTITY.package ||
      app?.getAttribute("required_version") !== policy.tizen ||
      document.querySelector("content")?.getAttribute("src") !== WIDGET_IDENTITY.entry
    )
      throw new Error("Widget version, identity, entry or target manifest mismatch.");
  } finally {
    dom.window.close();
  }
  return { ...checkArtifacts({ root, target }), experimental: policy.package.experimental };
}
