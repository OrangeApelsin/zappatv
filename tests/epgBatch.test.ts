import { afterEach, describe, expect, test, vi } from "vitest";
import {
  applyGuideOffset,
  BATCH_EPG_CHUNK_SIZE,
  chunkStreamIds,
  fetchBatchEpg,
  programmeProgress,
  resolveChannelNowNext,
} from "../src/services/epgBatch";
import type { XtreamSession } from "../src/services/xtream";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("EPG batch chunking and progress calculation", () => {
  test("chunks stream IDs into batches of at most 50 and strips live_ prefix", () => {
    const ids = Array.from({ length: 120 }, (_, index) =>
      index % 2 === 0 ? `live_${index + 1}` : `${index + 1}`,
    );
    const chunks = chunkStreamIds([...ids, "live_1", "   "]);

    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(BATCH_EPG_CHUNK_SIZE);
    expect(chunks[1]).toHaveLength(BATCH_EPG_CHUNK_SIZE);
    expect(chunks[2]).toHaveLength(20);
    expect(chunks[0][0]).toBe("1");
  });

  test("computes normalized programme progress and current/next programmes", () => {
    const resolved = resolveChannelNowNext(
      [
        {
          id: "2",
          title: "Next Show",
          description: "Upcoming",
          start: "2026-11-07 15:00:00",
          end: "2026-11-07 16:00:00",
          startTimestamp: 2000,
          stopTimestamp: 3000,
          archived: false,
        },
        {
          id: "1",
          title: "Live Show",
          description: "On Air",
          start: "2026-11-07 14:00:00",
          end: "2026-11-07 15:00:00",
          startTimestamp: 1000,
          stopTimestamp: 2000,
          archived: true,
        },
      ],
      1500,
    );

    expect(resolved.current?.title).toBe("Live Show");
    expect(resolved.next?.title).toBe("Next Show");
    expect(resolved.progress).toBe(0.5);
    expect(programmeProgress(resolved.current, 900)).toBe(0);
    expect(programmeProgress(resolved.current, 2100)).toBe(1);
  });

  test("fetches /api/epg/batch with x-zappa-token and resolves active programmes", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          live_101: {
            now: {
              id: "epg-1",
              title: "Evening News",
              description: "Top stories",
              start_timestamp: 1000,
              stop_timestamp: 2000,
              has_archive: 1,
            },
            next: {
              id: "epg-2",
              title: "Sports Tonight",
              description: "Highlights",
              start_timestamp: 2000,
              stop_timestamp: 3000,
              has_archive: 0,
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await fetchBatchEpg("http://provider.example:8000", "secret-token", ["101"], {
      nowSeconds: 1250,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://provider.example:8000/api/epg/batch?ids=live_101",
      {
        cache: "no-cache",
        signal: undefined,
        headers: { "x-zappa-token": "secret-token" },
      },
    );
    expect(result["101"].current?.title).toBe("Evening News");
    expect(result["101"].next?.title).toBe("Sports Tonight");
    expect(result["101"].progress).toBe(0.25);
  });

  test("falls back to Xtream get_short_epg when /api/epg/batch returns 404", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/api/epg/batch")) {
        return new Response("Not Found", { status: 404 });
      }
      return new Response(
        JSON.stringify({
          epg_listings: [
            {
              id: "short-1",
              title: btoa("Fallback Show"),
              description: btoa("From get_short_epg"),
              start: "2026-11-07 14:00:00",
              end: "2026-11-07 15:00:00",
              start_timestamp: "1000",
              stop_timestamp: "2000",
              has_archive: 1,
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const fallbackSession: XtreamSession = {
      server: "http://provider.example",
      username: "viewer",
      password: "secret",
      output: "ts",
      streamOrigin: "http://provider.example",
      account: { status: "Active", isTrial: false },
    };

    const result = await fetchBatchEpg("http://provider.example", undefined, ["55"], {
      nowSeconds: 1500,
      fallbackSession,
    });

    expect(result["55"]?.current?.title).toBe("Fallback Show");
    expect(result["55"]?.progress).toBe(0.5);
  });

  test("shifts programme timestamps and schedules when guide offset is applied", () => {
    const rawProgrammes = [
      {
        id: "1",
        title: "News",
        description: "News at noon",
        start: "2026-11-07 12:00:00",
        end: "2026-11-07 13:00:00",
        startTimestamp: 10000,
        stopTimestamp: 13600,
        archived: true,
      },
    ];
    const shifted = applyGuideOffset(rawProgrammes, 3600); // +1h
    expect(shifted[0].startTimestamp).toBe(13600);
    expect(shifted[0].stopTimestamp).toBe(17200);

    const shiftedNeg = applyGuideOffset(rawProgrammes, -7200); // -2h
    expect(shiftedNeg[0].startTimestamp).toBe(2800);
    expect(shiftedNeg[0].stopTimestamp).toBe(6400);
  });
});

