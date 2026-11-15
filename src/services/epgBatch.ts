import { loadXtreamGuide, type XtreamProgramme, type XtreamSession } from "./xtream";

export const BATCH_EPG_CHUNK_SIZE = 50;
export const BATCH_EPG_TTL_MS = 60_000;

export interface BatchEpgSnapshot {
  streamId: string;
  programmes: XtreamProgramme[];
  current?: XtreamProgramme;
  next?: XtreamProgramme;
  progress: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown): string =>
  typeof value === "string" || typeof value === "number" ? String(value) : "";

const toEpochSeconds = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value > 10_000_000_000 ? Math.floor(value / 1000) : Math.floor(value);
  }
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric > 10_000_000_000 ? Math.floor(numeric / 1000) : Math.floor(numeric);
    }
    const parsed = Date.parse(value.includes("T") ? value : value.replace(" ", "T"));
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed / 1000);
    }
  }
  return undefined;
};

const formatUtcTimestamp = (epochSeconds?: number, fallback = ""): string => {
  if (fallback) return fallback;
  if (epochSeconds === undefined) return "";
  const date = new Date(epochSeconds * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};

export function chunkStreamIds(
  streamIds: readonly string[],
  chunkSize = BATCH_EPG_CHUNK_SIZE,
): string[][] {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const raw of streamIds) {
    const cleaned = raw.trim().replace(/^live_/, "");
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    unique.push(cleaned);
  }
  const chunks: string[][] = [];
  const step = Math.max(1, Math.floor(chunkSize));
  for (let index = 0; index < unique.length; index += step) {
    chunks.push(unique.slice(index, index + step));
  }
  return chunks;
}

export function programmeProgress(
  programme: Pick<XtreamProgramme, "startTimestamp" | "stopTimestamp"> | undefined,
  nowSeconds = Math.floor(Date.now() / 1000),
): number {
  if (!programme) return 0;
  const start = programme.startTimestamp;
  const stop = programme.stopTimestamp;
  if (start === undefined || stop === undefined || stop <= start) return 0;
  if (nowSeconds <= start) return 0;
  if (nowSeconds >= stop) return 1;
  return Math.min(1, Math.max(0, (nowSeconds - start) / (stop - start)));
}

export function resolveChannelNowNext(
  programmes: readonly XtreamProgramme[],
  nowSeconds = Math.floor(Date.now() / 1000),
): {
  programmes: XtreamProgramme[];
  current?: XtreamProgramme;
  next?: XtreamProgramme;
  progress: number;
} {
  const sorted = [...programmes].sort(
    (left, right) =>
      (left.startTimestamp ?? Number.MAX_SAFE_INTEGER) -
      (right.startTimestamp ?? Number.MAX_SAFE_INTEGER),
  );
  const current = sorted.find(
    (item) =>
      item.startTimestamp !== undefined &&
      item.stopTimestamp !== undefined &&
      item.startTimestamp <= nowSeconds &&
      item.stopTimestamp > nowSeconds,
  );
  const nextAfter = current?.stopTimestamp ?? nowSeconds;
  const next = sorted.find(
    (item) =>
      item !== current &&
      item.startTimestamp !== undefined &&
      item.startTimestamp >= nextAfter,
  );
  return {
    programmes: sorted,
    ...(current ? { current } : {}),
    ...(next ? { next } : {}),
    progress: programmeProgress(current, nowSeconds),
  };
}

export function applyGuideOffset(
  programmes: readonly XtreamProgramme[],
  offsetSeconds: number,
): XtreamProgramme[] {
  if (!offsetSeconds) return [...programmes];
  return programmes.map((programme) => {
    const startTimestamp =
      programme.startTimestamp !== undefined ? programme.startTimestamp + offsetSeconds : undefined;
    const stopTimestamp =
      programme.stopTimestamp !== undefined ? programme.stopTimestamp + offsetSeconds : undefined;
    return {
      ...programme,
      startTimestamp,
      stopTimestamp,
      start: formatUtcTimestamp(startTimestamp, programme.start),
      end: formatUtcTimestamp(stopTimestamp, programme.end),
    };
  });
}

function normaliseBatchProgrammes(
  rawList: unknown,
  streamId: string,
  guideOffsetSeconds = 0,
): XtreamProgramme[] {
  const items = Array.isArray(rawList)
    ? rawList.filter(isRecord)
    : isRecord(rawList)
      ? [
          ...(isRecord(rawList.now) ? [rawList.now] : []),
          ...(isRecord(rawList.current) ? [rawList.current] : []),
          ...(isRecord(rawList.next) ? [rawList.next] : []),
          ...(Array.isArray(rawList.programmes) ? rawList.programmes.filter(isRecord) : []),
          ...(Array.isArray(rawList.programs) ? rawList.programs.filter(isRecord) : []),
        ]
      : [];

  const result: XtreamProgramme[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < items.length; index += 1) {
    const entry = items[index];
    const rawStart = toEpochSeconds(
      entry.start_timestamp ?? entry.startTimestamp ?? entry.start,
    );
    const rawStop = toEpochSeconds(
      entry.stop_timestamp ?? entry.stopTimestamp ?? entry.stop ?? entry.end,
    );
    const startTimestamp = rawStart !== undefined ? rawStart + guideOffsetSeconds : undefined;
    const stopTimestamp = rawStop !== undefined ? rawStop + guideOffsetSeconds : undefined;
    const title = text(entry.title ?? entry.name).trim();
    if (!title) continue;
    const id =
      text(entry.id ?? entry.epg_id) ||
      `${streamId}:${startTimestamp ?? index}:${stopTimestamp ?? index}`;
    if (seen.has(id)) continue;
    seen.add(id);
    result.push({
      id,
      title,
      description: text(entry.description ?? entry.desc),
      start: formatUtcTimestamp(startTimestamp, text(entry.start)),
      end: formatUtcTimestamp(stopTimestamp, text(entry.end ?? entry.stop)),
      ...(startTimestamp !== undefined ? { startTimestamp } : {}),
      ...(stopTimestamp !== undefined ? { stopTimestamp } : {}),
      archived: Number(entry.has_archive ?? entry.archived) === 1,
    });
  }
  return result;
}

export async function fetchBatchEpg(
  server: string,
  token: string | undefined,
  streamIds: readonly string[],
  options: {
    signal?: AbortSignal;
    nowSeconds?: number;
    fallbackSession?: XtreamSession;
    guideOffsetSeconds?: number;
  } = {},
): Promise<Record<string, BatchEpgSnapshot>> {
  const chunks = chunkStreamIds(streamIds, BATCH_EPG_CHUNK_SIZE);
  if (!chunks.length) return {};

  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const guideOffsetSeconds = options.guideOffsetSeconds ?? 0;
  const snapshots: Record<string, BatchEpgSnapshot> = {};
  const cleanServer = server.trim().replace(/\/+$/, "");

  for (const chunk of chunks) {
    const queryIds = chunk.map((id) => `live_${id}`).join(",");
    const url = `${cleanServer}/api/epg/batch?ids=${encodeURIComponent(queryIds).replace(/%2C/gi, ",")}`;
    const headers: Record<string, string> = {};
    if (token?.trim()) {
      headers["x-zappa-token"] = token.trim();
    }

    try {
      const response = await fetch(url, {
        cache: "no-cache",
        signal: options.signal,
        ...(Object.keys(headers).length ? { headers } : {}),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const payload = await response.json();
      const map = isRecord(payload) && isRecord(payload.data) ? payload.data : payload;
      if (!isRecord(map)) {
        throw new Error("Invalid batch EPG payload");
      }

      for (const streamId of chunk) {
        const entry = map[`live_${streamId}`] ?? map[streamId];
        const programmes = normaliseBatchProgrammes(entry, streamId, guideOffsetSeconds);
        const resolved = resolveChannelNowNext(programmes, nowSeconds);
        snapshots[streamId] = {
          streamId,
          ...resolved,
        };
      }
    } catch (error) {
      if (options.signal?.aborted) throw error;
      if (!options.fallbackSession) continue;

      const fallbackSession = options.fallbackSession;
      await Promise.all(
        chunk.map(async (streamId) => {
          try {
            const rawProgrammes = await loadXtreamGuide(
              fallbackSession,
              streamId,
              options.signal,
            );
            const programmes = applyGuideOffset(rawProgrammes, guideOffsetSeconds);
            const resolved = resolveChannelNowNext(programmes, nowSeconds);
            snapshots[streamId] = {
              streamId,
              ...resolved,
            };
          } catch {
            // Leave channel without EPG on individual fallback failure
          }
        }),
      );
    }
  }

  return snapshots;
}

