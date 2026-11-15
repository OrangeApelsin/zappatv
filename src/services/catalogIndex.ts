import type { ShapedVodItem, VodGroup } from "../workers/vodWorker";
import { searchKey } from "../workers/vodWorker";
import { throwIfAborted } from "./catalogCancellation";
import { catalogYield } from "./catalogYield";
import {
  compareTitleKeys,
  titleCollator,
  titleKey,
  titleKeyLetter,
  titleLetter,
} from "./catalogTitle";
import { mediaKey } from "./mediaIdentity";
import type { XtreamMovie, XtreamSeries } from "./xtream";

export type CatalogItem =
  | (ShapedVodItem & XtreamMovie & { kind: "movie" })
  | (ShapedVodItem & XtreamSeries & { kind: "series" });
export type CatalogSort = "added" | "name" | "year" | "rating";
export const INGEST_BATCH_SIZE = 250;
export const INDEX_BATCH_SIZE = 2048;
const empty: CatalogItem[] = [];
const comparators: Record<CatalogSort, (a: CatalogItem, b: CatalogItem) => number> = {
  added: (a, b) => (b.added || 0) - (a.added || 0),
  name: (a, b) => a.name.localeCompare(b.name),
  year: (a, b) => (Number(b.year) || 0) - (Number(a.year) || 0),
  rating: (a, b) => (Number(b.rating) || 0) - (Number(a.rating) || 0),
};

/** One object per item. Extra arrays are reusable indexes of references, never
 * alternate normalized catalogs. A new owner is published only after completion. */
export class CatalogIndex {
  readonly items: CatalogItem[] = [];
  readonly byKey = new Map<string, CatalogItem>();
  readonly byCategory = new Map<string, CatalogItem[]>();
  private titleKeys = new WeakMap<CatalogItem, string>();
  private sorted = new Map<CatalogSort, Map<string | null, CatalogItem[]>>();
  private letters = new WeakMap<ShapedVodItem[], Set<string>>();
  private firstLetters = new WeakMap<ShapedVodItem[], Map<string, number>>();
  private positions = new WeakMap<ShapedVodItem[], Map<string, number>>();
  completedAt = 0;
  maxIngestBatch = 0;
  maxIndexBatch = 0;
  constructor(
    readonly scope: string,
    readonly kind: "movie" | "series",
    readonly groups: VodGroup[],
  ) {}
  add(batch: ShapedVodItem[]): void {
    if (batch.length > INGEST_BATCH_SIZE) throw new Error("Catalog ingestion batch exceeded");
    this.maxIngestBatch = Math.max(this.maxIngestBatch, batch.length);
    for (const shaped of batch) {
      if (shaped.kind !== this.kind) throw new Error("Catalog kind mismatch");
      const id = shaped.streamId ?? shaped.seriesId;
      if (!id) throw new Error("Catalog identity missing");
      const key = mediaKey(this.scope, this.kind, id);
      if (this.byKey.has(key)) throw new Error("Duplicate catalog item");
      const item = Object.assign(shaped, {
        key,
        categoryKey: `${this.kind}:${shaped.categoryId ?? ""}`,
        extension: shaped.ext || "mp4",
        year: shaped.year || "",
        url: undefined,
      }) as CatalogItem;
      this.titleKeys.set(item, titleKey(item.name));
      this.items.push(item);
      this.byKey.set(key, item);
      let category = this.byCategory.get(item.categoryKey);
      if (!category) {
        category = [];
        this.byCategory.set(item.categoryKey, category);
      }
      category.push(item);
    }
  }
  async finish(
    signal: AbortSignal,
    onProgress?: (completed: number, total: number) => void,
  ): Promise<void> {
    const yieldWork = catalogYield();
    let completed = 0;
    for (const mode of Object.keys(comparators) as CatalogSort[]) {
      throwIfAborted(signal);
      const compare =
        mode === "name"
          ? (a: CatalogItem, b: CatalogItem) =>
              compareTitleKeys(this.titleKeys.get(a)!, this.titleKeys.get(b)!) ||
              titleCollator.compare(a.key, b.key)
          : comparators[mode];
      // Bottom-up merge sort with a fixed work quantum instead of one blocking
      // native sort for every render/category interaction.
      let source = this.items.slice();
      let target = new Array<CatalogItem>(source.length);
      let work = 0;
      const step = async () => {
        this.maxIndexBatch = Math.max(this.maxIndexBatch, work);
        work = 0;
        await yieldWork();
        throwIfAborted(signal);
      };
      for (let width = 1; width < source.length; width *= 2) {
        for (let start = 0; start < source.length; start += width * 2) {
          const middle = Math.min(start + width, source.length);
          const end = Math.min(start + width * 2, source.length);
          let left = start;
          let right = middle;
          for (let out = start; out < end; out++) {
            target[out] =
              left < middle && (right >= end || compare(source[left], source[right]) <= 0)
                ? source[left++]
                : source[right++];
            if (++work === INDEX_BATCH_SIZE) await step();
          }
        }
        [source, target] = [target, source];
      }
      const index = new Map<string | null, CatalogItem[]>([[null, source]]);
      const allLetters = new Set<string>();
      this.letters.set(source, allLetters);
      const firstLetters = new Map<string, number>();
      this.firstLetters.set(source, firstLetters);
      this.positions.set(source, new Map());
      for (let position = 0; position < source.length; position++) {
        const item = source[position];
        const id = item.categoryId ?? "";
        let category = index.get(id);
        if (!category) {
          category = [];
          index.set(id, category);
          this.letters.set(category, new Set());
          this.firstLetters.set(category, new Map());
          this.positions.set(category, new Map());
        }
        category.push(item);
        this.positions.get(source)!.set(item.key, position);
        this.positions.get(category)!.set(item.key, category.length - 1);
        const letter = titleKeyLetter(this.titleKeys.get(item)!);
        {
          allLetters.add(letter);
          this.letters.get(category)!.add(letter);
          if (!firstLetters.has(letter)) firstLetters.set(letter, position);
          const categoryLetters = this.firstLetters.get(category)!;
          if (!categoryLetters.has(letter)) categoryLetters.set(letter, category.length - 1);
        }
        if (++work === INDEX_BATCH_SIZE) await step();
      }
      this.maxIndexBatch = Math.max(this.maxIndexBatch, work);
      this.sorted.set(mode, index);
      onProgress?.(++completed, Object.keys(comparators).length);
    }
    throwIfAborted(signal);
    this.completedAt = Date.now();
  }
  query(category: string | null = null, mode: CatalogSort = "name"): CatalogItem[] {
    return this.sorted.get(mode)?.get(category) ?? empty;
  }
  availableLetters(items: CatalogItem[]): Set<string> {
    this.indexSubset(items);
    return this.letters.get(items) ?? new Set();
  }
  letterIndex(items: ShapedVodItem[], letter: string): number {
    this.indexSubset(items);
    return this.firstLetters.get(items)?.get(letter) ?? -1;
  }
  indexOfKey(items: ShapedVodItem[], key: string): number {
    this.indexSubset(items);
    return this.positions.get(items)?.get(key) ?? -1;
  }
  private indexSubset(items: ShapedVodItem[]): void {
    if (this.positions.has(items)) return;
    const positions = new Map<string, number>();
    const letters = new Map<string, number>();
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      positions.set(item.key, index);
      const letter = titleLetter(item.name);
      if (!letters.has(letter)) letters.set(letter, index);
    }
    this.positions.set(items, positions);
    this.firstLetters.set(items, letters);
    this.letters.set(items, new Set(letters.keys()));
  }
  search(term: string, excluded?: ReadonlySet<string>): CatalogItem[] {
    const query = searchKey(term);
    if (!query && !excluded?.size) return this.items;
    return this.items.filter(
      (item) => !excluded?.has(item.categoryKey) && (!query || item.skey.includes(query)),
    );
  }
}
