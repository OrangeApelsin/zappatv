import { searchKey } from "../workers/vodWorker";

// The TV rail is A-Z plus #. Fold Latin accents into that same alphabet;
// punctuation is ignored, while digits and non-Latin titles form the final # block.
export const titleCollator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
export function titleKey(name: string): string {
  return searchKey(name)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
}
export function titleKeyLetter(key: string): string {
  const first = (key[0] ?? "").toUpperCase();
  return first >= "A" && first <= "Z" ? first : "#";
}
export function titleLetter(name: string): string {
  return titleKeyLetter(titleKey(name));
}
export function compareTitleKeys(left: string, right: string): number {
  const a = titleKeyLetter(left),
    b = titleKeyLetter(right);
  if (a !== b) return a === "#" ? 1 : b === "#" ? -1 : a < b ? -1 : 1;
  return titleCollator.compare(left, right);
}
