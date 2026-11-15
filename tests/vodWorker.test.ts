import { dbDrop, dbGet, dbPut, isFresh, saveResult } from "../src/services/vodCache";
import { describe, expect, it } from "vitest";
import { vodPrefetch } from "../src/services/vodPrefetch";
import {
  type RawCategory,
  categoryIndex,
  readList,
  readWhole,
  searchKey,
  shapeOne,
} from "../src/workers/vodWorker";

describe("VOD Worker & Parser Engine", () => {
  it("normalizes search keys by stripping punctuation and lowercasing", () => {
    expect(searchKey("The Dark Knight (2008) [1080p]!")).toBe("the dark knight 2008 1080p");
    expect(searchKey("  Spider-Man: No Way Home...  ")).toBe("spider man no way home");
    expect(searchKey(null)).toBe("");
  });

  it("builds category lookup index correctly", () => {
    const categories: RawCategory[] = [
      { category_id: "1", category_name: "Action" },
      { category_id: 2, category_name: "Comedy" },
      { category_id: "3", name: "Drama" },
    ];
    const index = categoryIndex(categories);
    expect(index["1"]).toBe("Action");
    expect(index["2"]).toBe("Comedy");
    expect(index["3"]).toBe("Drama");
    expect(index["99"]).toBeUndefined();
  });

  it("shapes raw Xtream movie records accurately", () => {
    const catMap = { "10": "Sci-Fi" };
    const raw = {
      stream_id: 4567,
      name: "Interstellar",
      stream_icon: "https://img.example/poster.jpg",
      category_id: "10",
      container_extension: "mkv",
      rating: "8.7",
      year: "2014",
      tmdb: 157336,
    };
    const item = shapeOne("vod", catMap, raw, 1, "http://tv.example/movie/{ID}.{EXT}");
    expect(item).not.toBeNull();
    expect(item?.kind).toBe("movie");
    expect(item?.key).toBe("v4567");
    expect(item?.streamId).toBe("4567");
    expect(item?.name).toBe("Interstellar");
    expect(item?.group).toBe("Sci-Fi");
    expect(item?.ext).toBe("mkv");
    expect(item?.year).toBe("2014");
    expect(item?.tmdb).toBe(157336);
    expect(item?.url).toBe("");
  });

  it("shapes raw Xtream series records accurately", () => {
    const catMap = { "20": "Drama" };
    const raw = {
      series_id: 8899,
      name: "Breaking Bad",
      cover: "https://img.example/bb.jpg",
      category_id: "20",
      rating: "9.5",
      releaseDate: "2008-01-20",
      plot: "A high school chemistry teacher diagnosed with cancer...",
      genre: "Crime, Drama",
    };
    const item = shapeOne("series", catMap, raw, 1);
    expect(item).not.toBeNull();
    expect(item?.kind).toBe("series");
    expect(item?.key).toBe("s8899");
    expect(item?.seriesId).toBe("8899");
    expect(item?.name).toBe("Breaking Bad");
    expect(item?.group).toBe("Drama");
    expect(item?.year).toBe("2008");
    expect(item?.genre).toBe("Crime, Drama");
    expect(item?.plot).toContain("chemistry teacher");
  });

  it("streams and decodes chunked ArrayBuffer JSON with bracket depth counter", async () => {
    const categories: RawCategory[] = [
      { category_id: "1", category_name: "Action" },
      { category_id: "2", category_name: "Drama" },
    ];

    // Generate 1200 mock items to cross the 1000 PIECE_SIZE chunk boundary
    const items = [];
    for (let i = 1; i <= 1200; i++) {
      items.push({
        stream_id: i,
        name: `Movie Title ${i}`,
        category_id: i % 2 === 0 ? "1" : "2",
        container_extension: "mp4",
        rating: "7.5",
        year: "2023",
      });
    }

    const jsonStr = JSON.stringify(items);
    const buffer = new TextEncoder().encode(jsonStr).buffer;

    const result = await readList(buffer, "vod", categories, "http://tv.example/vod/{ID}.{EXT}");
    expect(result.count).toBe(1200);
    expect(result.pieces.length).toBe(2);

    const piece0 = JSON.parse(result.pieces[0]);
    const piece1 = JSON.parse(result.pieces[1]);
    expect(piece0.length).toBe(1000);
    expect(piece1.length).toBe(200);

    expect(piece0[0].name).toBe("Movie Title 1");
    expect(piece0[0].url).toBe("");
    expect(piece1[199].name).toBe("Movie Title 1200");

    const actionGroup = result.groups.find((g) => g.name === "Action");
    const dramaGroup = result.groups.find((g) => g.name === "Drama");
    expect(actionGroup?.count).toBe(600);
    expect(dramaGroup?.count).toBe(600);
  });

  it("falls back to readWhole if JSON structure requires direct parsing", () => {
    const raw = [
      { stream_id: 101, name: "Fallback Movie", category_id: "1" },
      { stream_id: 102, name: "Second Movie", category_id: "1" },
    ];
    const bytes = new TextEncoder().encode(JSON.stringify(raw));
    const result = readWhole(bytes, "vod", [{ category_id: "1", category_name: "General" }]);
    expect(result.count).toBe(2);
    expect(result.pieces.length).toBe(1);
  });

  it("handles storage operations and TTL freshness checks", async () => {
    const testKey = "test_meta_key";
    await dbPut(testKey, { count: 42, t: Date.now(), n: 1 });
    const stored = await dbGet<{ count: number; t: number; n: number }>(testKey);
    expect(stored?.count).toBe(42);

    expect(isFresh(stored, 60000)).toBe(true);
    // Expired TTL
    expect(isFresh({ ...stored!, t: Date.now() - 100000 }, 60000)).toBe(false);

    await dbDrop(testKey);
    const afterDrop = await dbGet(testKey);
    expect(afterDrop).toBeNull();
  });

  it("persists results via saveResult and takes chunks progressively", async () => {
    const playlistId = "pl_test_99";
    const rawItems = [
      { stream_id: 1, name: "Alpha", category_id: "1" },
      { stream_id: 2, name: "Beta", category_id: "1" },
    ];
    const buffer = new TextEncoder().encode(JSON.stringify(rawItems)).buffer;

    const savedCount = await saveResult("direct_save_key", {
      count: 1,
      groups: [{ id: "G1", name: "G1", count: 1 }],
      pieces: [
        JSON.stringify([
          {
            kind: "movie",
            name: "Direct",
            skey: "direct",
            key: "v1",
            streamId: "1",
            logo: "",
            group: "G1",
            num: 1,
            rating: "5",
          },
        ]),
      ],
    });
    expect(savedCount).toBe(1);
    const directMeta = await dbGet("direct_save_key");
    expect(directMeta).toBeTruthy();

    const count = await vodPrefetch.read({
      playlistId,
      kind: "vod",
      buffer,
      categories: [{ category_id: "1", category_name: "Catalog" }],
    });
    expect(count).toBe(2);

    const chunksEmitted: number[] = [];
    const takeResult = await vodPrefetch.take(
      playlistId,
      "vod",
      60000,
      (chunkItems) => {
        chunksEmitted.push(chunkItems.length);
      },
    );

    expect(takeResult.items.length).toBe(2);
    expect(takeResult.groups.length).toBe(1);
    expect(takeResult.groups[0].name).toBe("Catalog");
    expect(chunksEmitted.length).toBeGreaterThan(0);

    // Clean up
    await vodPrefetch.clear(playlistId);
    const hasCount = await vodPrefetch.has(playlistId, "vod", 60000);
    expect(hasCount).toBe(0);
  });
});
