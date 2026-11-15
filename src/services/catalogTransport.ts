import { abortError, throwIfAborted } from "./catalogCancellation";
export const MAX_CATALOG_BYTES = 64 * 1024 * 1024;

export function httpRequest(
  url: string,
  responseType: "arraybuffer" | "text" = "text",
  timeout = 90000,
  signal?: AbortSignal,
  onTiming?: (timing: { providerResponse: number; download: number }) => void,
  onProgress?: (progress: { bytes: number; totalBytes: number }) => void,
): Promise<ArrayBuffer | string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const xhr = new XMLHttpRequest();
    const started = performance.now();
    let headersAt: number | undefined;
    let finished = false;
    let timer: ReturnType<typeof setTimeout>;
    const finish = (error?: Error, value?: ArrayBuffer | string) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancelled);
      xhr.onload = xhr.onerror = xhr.ontimeout = xhr.onabort = xhr.onprogress = null;
      xhr.onreadystatechange = null;
      if (error) reject(error);
      else resolve(value!);
    };
    const fail = (message: string) =>
      finish(Object.assign(new Error(message), { name: "CatalogNetworkError" }));
    const stop = (error: Error) => {
      finish(error);
      try {
        xhr.abort();
      } catch {}
    };
    const cancelled = () => stop(abortError());
    signal?.addEventListener("abort", cancelled, { once: true });
    timer = setTimeout(
      () =>
        stop(
          Object.assign(new Error("Catalog request timed out"), {
            name: "CatalogNetworkError",
          }),
        ),
      timeout,
    );
    try {
      throwIfAborted(signal);
      xhr.open("GET", url, true);
      xhr.responseType = responseType;
      xhr.timeout = timeout;
      xhr.onreadystatechange = () => {
        if (finished) return;
        if (xhr.readyState === 2 && headersAt === undefined) {
          headersAt = performance.now();
          onProgress?.({ bytes: 0, totalBytes: 0 });
        }
      };
      xhr.onprogress = (event) => {
        if (finished) return;
        if (event.loaded > MAX_CATALOG_BYTES) stop(new Error("Catalog exceeds transfer limit"));
        else
          onProgress?.({
            bytes: event.loaded,
            totalBytes: event.lengthComputable ? event.total : 0,
          });
      };
      xhr.onload = () => {
        if (xhr.status < 200 || xhr.status >= 300) {
          fail(`Catalog HTTP ${xhr.status}`);
          return;
        }
        const value = xhr.response as string | ArrayBuffer;
        const size = typeof value === "string" ? value.length * 2 : value?.byteLength;
        if (!Number.isFinite(size) || size > MAX_CATALOG_BYTES) {
          fail("Catalog exceeds transfer limit");
          return;
        }
        if (headersAt !== undefined)
          onTiming?.({
            providerResponse: headersAt - started,
            download: performance.now() - headersAt,
          });
        finish(undefined, value);
      };
      xhr.onerror = xhr.ontimeout = () => fail("Catalog request failed");
      xhr.onabort = () => finish(abortError());
      xhr.send();
    } catch {
      finish(signal?.aborted ? abortError() : new Error("Catalog transport unavailable"));
    }
  });
}
