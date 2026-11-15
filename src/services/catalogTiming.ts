/** Bounded, credential-free diagnostic timings. Durations are host observations,
 * never TV acceptance. Capture zappa-catalog-timing events in a TV inspector. */
export type CatalogPhase =
  | "cacheRead"
  | "authentication"
  | "categories"
  | "fetchParseCache"
  | "ingestion"
  | "index"
  | "publication"
  | "firstUsablePaint";
export interface CatalogTiming {
  kind: "movie" | "series";
  mode: "network" | "disk" | "memory";
  status: "loading" | "ready" | "failed" | "cancelled";
  count: number;
  totalMs: number;
  phases: Partial<
    Record<
      | CatalogPhase
      | "transfer"
      | "providerResponse"
      | "download"
      | "parse"
      | "cachePreparePersist",
      number
    >
  >;
}
const latest = new Map<string, CatalogTiming>();
const ready = new Map<string, CatalogTiming>();
let epoch = 0;
export function resetCatalogTimings(): void {
  epoch++;
  latest.clear();
  ready.clear();
}
const now = () => performance.now();
export function catalogTimings(): CatalogTiming[] {
  return [...latest.values()].map((item) => ({ ...item, phases: { ...item.phases } }));
}
export function startCatalogTiming(kind: "movie" | "series") {
  const owned = epoch;
  const start = now();
  let previous = start;
  const record: CatalogTiming = {
    kind,
    mode: "network",
    status: "loading",
    count: 0,
    totalMs: 0,
    phases: {},
  };
  return {
    record,
    phase(name: CatalogPhase) {
      const time = now();
      record.phases[name] = time - previous;
      previous = time;
    },
    publish(status: CatalogTiming["status"]) {
      if (owned !== epoch) return;
      record.status = status;
      record.totalMs = now() - start;
      latest.set(`${kind}:${record.mode}`, record);
      if (status === "ready") ready.set(kind, record);
      if (typeof window !== "undefined")
        window.dispatchEvent(
          new CustomEvent("zappa-catalog-timing", {
            detail: { ...record, phases: { ...record.phases } },
          }),
        );
    },
  };
}
export function catalogPaint(kind: "movie" | "series", durationMs: number): void {
  // The view owns its paint duration; it must not overwrite another load's trace.
  const record = ready.get(kind);
  if (!record || record.phases.firstUsablePaint !== undefined) return;
  record.phases.firstUsablePaint = durationMs;
  if (typeof window !== "undefined")
    window.dispatchEvent(
      new CustomEvent("zappa-catalog-timing", {
        detail: { ...record, phases: { ...record.phases } },
      }),
    );
}
