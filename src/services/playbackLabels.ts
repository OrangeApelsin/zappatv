import type { MessageKey } from "./locale";
import type { AudioTrack, SubtitleTrack } from "./player";

const languages: Record<string, MessageKey> = {
  swe: "track.sv",
  sv: "track.sv",
  eng: "track.en",
  en: "track.en",
  ara: "track.ar",
  ar: "track.ar",
  nor: "track.no",
  no: "track.no",
  dan: "track.da",
  da: "track.da",
  fin: "track.fi",
  fi: "track.fi",
  ger: "track.de",
  deu: "track.de",
  de: "track.de",
  fra: "track.fr",
  fre: "track.fr",
  fr: "track.fr",
  spa: "track.es",
  es: "track.es",
  ita: "track.it",
  it: "track.it",
  und: "track.default",
  qaa: "track.original",
};
export type VideoQualityTier = "SD" | "HD" | "FHD" | "4K";

/** Map pixel dimensions reported by AVPlay to standard TV resolution tiers. */
export function classifyResolution(width?: number, height?: number): VideoQualityTier | null {
  const w = typeof width === "number" && Number.isFinite(width) && width > 0 ? width : 0;
  const h = typeof height === "number" && Number.isFinite(height) && height > 0 ? height : 0;
  if (!w && !h) return null;
  if (h >= 2160 || w >= 3840) return "4K";
  if (h >= 1080 || w >= 1920) return "FHD";
  if (h >= 720 || w >= 1280) return "HD";
  return "SD";
}

/** Normalise common playlist or UI resolution strings into a canonical tier. */
export function normalizeQualityTier(label?: string | null): VideoQualityTier | null {
  if (!label) return null;
  const upper = label.trim().toUpperCase();
  if (!upper) return null;
  if (upper === "4K" || upper === "UHD" || upper === "2160P" || upper === "2160") return "4K";
  if (upper === "FHD" || upper === "1080P" || upper === "1080I" || upper === "1080") return "FHD";
  if (upper === "HD" || upper === "720P" || upper === "720") return "HD";
  if (upper === "SD" || upper === "576P" || upper === "576I" || upper === "480P" || upper === "480I") {
    return "SD";
  }
  return null;
}

export function trackLabel(
  track: AudioTrack | SubtitleTrack | undefined,
  t: (key: MessageKey) => string,
): string {
  if (!track) return t("osd.auto");
  const code = track.language.toLowerCase().trim() || "und";
  const language = languages[code] ? t(languages[code]) : code.toUpperCase();
  return track.format ? `${language} (${track.format})` : language;
}
