import { abortable, throwIfAborted } from "./catalogCancellation";
import type { XtreamCategory } from "./xtream";

type Request = {
  task: Promise<XtreamCategory[]>;
  controller: AbortController;
  users: number;
  settled: boolean;
};
type Entry = { items?: XtreamCategory[]; at: number; bytes: number; request?: Request };
const entries = new Map<string, Entry>();
const TTL = 6 * 60 * 60 * 1000;
const MAX_ENTRIES = 12;
const DEADLINE = 30000;
const HEADING_BUDGET_BYTES = 2 * 1024 * 1024;

/** Shared small category headings for live setup and the on-demand catalog.
 * Keys contain the opaque source identity, never credential-bearing URLs.
 * A caller owns its subscription; only the last cancellation stops transport. */
export function categoryRequest(
  key: string,
  load: (signal: AbortSignal) => Promise<XtreamCategory[]>,
  signal?: AbortSignal,
  force = false,
): Promise<XtreamCategory[]> {
  if (signal?.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
  let entry = entries.get(key);
  if (!entry) {
    if (entries.size >= MAX_ENTRIES) {
      const oldest = [...entries].find(([, value]) => !value.request);
      if (oldest) entries.delete(oldest[0]);
      else return Promise.reject(new Error("Too many active category requests"));
    }
    entry = { at: 0, bytes: 0 };
    entries.set(key, entry);
  }
  if (!force && entry.items && Date.now() - entry.at < TTL) return Promise.resolve(entry.items);
  if (entry.request?.controller.signal.aborted) entry.request = undefined;
  if (!entry.request) {
    const controller = new AbortController();
    const owner = entry;
    const timer = setTimeout(() => controller.abort(), DEADLINE);
    const task = abortable(
      Promise.resolve().then(() => {
        throwIfAborted(controller.signal);
        return load(controller.signal);
      }),
      controller.signal,
    ).then((items) => {
      throwIfAborted(controller.signal);
      if (items.length > 10000) throw new Error("Too many catalog categories");
      const bytes = items.reduce(
        (sum, item) =>
          sum +
          64 +
          2 * (item.key.length + item.id.length + item.name.length + item.kind.length),
        0,
      );
      if (bytes > HEADING_BUDGET_BYTES)
        throw new Error("Catalog category headings exceed memory limit");
      let total =
        [...entries.values()].reduce((sum, value) => sum + value.bytes, 0) -
        owner.bytes +
        bytes;
      for (const value of entries.values()) {
        if (total <= HEADING_BUDGET_BYTES) break;
        if (value === owner) continue;
        total -= value.bytes;
        value.items = undefined;
        value.at = 0;
        value.bytes = 0;
      }
      owner.items = items;
      owner.at = Date.now();
      owner.bytes = bytes;
      return items;
    });
    const request: Request = { task, controller, users: 0, settled: false };
    owner.request = request;
    const finish = () => {
      clearTimeout(timer);
      request.settled = true;
      if (owner.request === request) owner.request = undefined;
    };
    void task.then(finish, finish);
  }
  const request = entry.request!;
  request.users++;
  const subscribed = signal ? abortable(request.task, signal) : request.task;
  return subscribed.finally(() => {
    request.users--;
    if (!request.users && !request.settled) request.controller.abort();
  });
}
