import type { RawCategory, ReadResult } from "./vodWorker";
export interface CatalogWork {
  op: "read" | "fetch";
  key: string;
  kind: "vod" | "series";
  buf?: ArrayBuffer;
  cats?: RawCategory[];
  catsUrl?: string;
  listUrl?: string;
}
export type CatalogRequest = CatalogWork & { id: number; generation: number };
export type CatalogResponse =
  | { type: "ready"; ready: true }
  | {
      type: "progress";
      id: number;
      generation: number;
      key: string;
      loaded: number;
      bytes: number;
      totalBytes: number;
      phase?: "download" | "parse";
    }
  | { type: "success"; id: number; generation: number; key: string; result: ReadResult }
  | {
      type: "error";
      id: number;
      generation: number;
      key: string;
      code: "invalid" | "network" | "cancelled" | "unavailable";
    };
export interface CatalogProgress {
  loaded: number;
  bytes: number;
  totalBytes: number;
  phase?: "download" | "parse";
}
