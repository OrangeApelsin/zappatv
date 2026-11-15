export const abortError = () =>
  Object.assign(new Error("Catalog request cancelled"), { name: "AbortError" });
export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

/** Also usable inside M63 workers, where AbortController is absent. Only our
 * XHR/parser/client uses this signal; it is never passed into native fetch.
 */
export function catalogController(): { signal: AbortSignal; abort: () => void } {
  const listeners = new Set<EventListenerOrEventListenerObject>();
  const state = {
    aborted: false,
    addEventListener(_type: string, listener: EventListenerOrEventListenerObject | null) {
      if (listener) listeners.add(listener);
    },
    removeEventListener(_type: string, listener: EventListenerOrEventListenerObject | null) {
      if (listener) listeners.delete(listener);
    },
  };
  return {
    signal: state as unknown as AbortSignal,
    abort() {
      if (state.aborted) return;
      state.aborted = true;
      for (const listener of [...listeners]) {
        const event = { type: "abort", target: state } as unknown as Event;
        if (typeof listener === "function") listener(event);
        else listener.handleEvent(event);
      }
      listeners.clear();
    },
  };
}

export function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = (work: () => void) => {
      if (finished) return;
      finished = true;
      signal.removeEventListener("abort", cancelled);
      work();
    };
    const cancelled = () => finish(() => reject(abortError()));
    signal.addEventListener("abort", cancelled, { once: true });
    void promise.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
    if (signal.aborted) cancelled();
  });
}
