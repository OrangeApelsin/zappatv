import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { targetPolicy, widgetName } from "./tv/platforms.mjs";

export const sha256 = (data) => createHash("sha256").update(data).digest("hex");
export const checksumText = (hash, name) => `${hash}  ${name}\n`;

export const WIDGET_IDENTITY = Object.freeze({
  widget: "http://zappa.local/ZappaTV",
  application: "ZappaTV002.ZappaTV",
  package: "ZappaTV002",
  entry: "index.html",
});
export function validateWidgetVersion(version) {
  if (typeof version !== "string" || !/^\d+\.\d+(?:\.\d+)?$/.test(version))
    throw new Error("Widget version must contain two or three dotted integers.");
  return version;
}
export function packageVersion(
  file = resolve(dirname(fileURLToPath(import.meta.url)), "../package.json"),
) {
  return validateWidgetVersion(JSON.parse(readFileSync(file, "utf8")).version);
}
export function widgetMetadata({ target = "5.5", version = packageVersion() } = {}) {
  validateWidgetVersion(version);
  const policy = targetPolicy(target);
  return {
    ...WIDGET_IDENTITY,
    version,
    target: policy.tizen,
    name: widgetName(version, target),
    experimental: policy.package.experimental,
  };
}
function stamp(file, expression, value, label) {
  const xml = readFileSync(file, "utf8");
  if (!expression.test(xml)) throw new Error(`Manifest has no ${label} attribute.`);
  const stamped = xml.replace(expression, (_match, prefix, suffix) => prefix + value + suffix);
  if (stamped !== xml) writeFileSync(file, stamped);
}
export function stampVersion(file, version) {
  stamp(
    file,
    /(<widget\b[\s\S]*?\sversion=")[^"]*(")/,
    validateWidgetVersion(version),
    "widget version",
  );
}
export function stampRequiredVersion(file, target) {
  stamp(
    file,
    /(<(?:[\w.-]+:)?application\b[\s\S]*?\srequired_version=")[^"]*(")/,
    targetPolicy(target).tizen,
    "required_version",
  );
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const target =
    process.argv.find((value) => value.startsWith("--target="))?.slice(9) ??
    process.env.TIZEN_TARGET ??
    "5.5";
  const field = process.argv.find((value) => value.startsWith("--field="))?.slice(8);
  const meta = widgetMetadata({ target });
  if (field && !Object.hasOwn(meta, field)) throw new Error("Unknown metadata field.");
  console.log(field ? meta[field] : JSON.stringify(meta));
}
