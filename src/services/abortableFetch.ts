/** Preserve native cancellation; use abortable XHR for signalled legacy requests.
 * Legacy responses are buffered. Unsupported fetch policies fail explicitly.
 */
export function supportsNativeAbortFetch(): boolean {
  try {
    if (typeof AbortController !== "function" || typeof Request !== "function") return false;
    const controller = new AbortController();
    const request = new Request("https://abort-check.invalid/", { signal: controller.signal });
    controller.abort();
    return request.signal?.aborted === true;
  } catch {
    return false;
  }
}

const aborted = (signal: AbortSignal) =>
  signal.reason !== undefined
    ? signal.reason
    : new DOMException("The operation was aborted", "AbortError");

function bindBody(
  response: Response,
  signal: AbortSignal,
  url: string,
  redirected: boolean,
): Response {
  Object.defineProperties(response, { url: { value: url }, redirected: { value: redirected } });
  for (const method of ["arrayBuffer", "blob", "formData", "json", "text"] as const) {
    if (typeof response[method] !== "function") continue;
    const read = response[method] as () => Promise<unknown>;
    Object.defineProperty(response, method, {
      value: () => {
        if (signal.aborted) return Promise.reject(aborted(signal));
        return read.call(response).then((value) => {
          if (signal.aborted) throw aborted(signal);
          return value;
        });
      },
    });
  }
  const clone = response.clone.bind(response);
  Object.defineProperty(response, "clone", {
    value: () => {
      if (signal.aborted) throw aborted(signal);
      return bindBody(clone(), signal, url, redirected);
    },
  });
  return response;
}

function validateLegacyRequest(request: Request, init?: RequestInit) {
  if (
    (init?.mode ?? request.mode) === "no-cors" ||
    (init?.redirect ?? request.redirect ?? "follow") !== "follow" ||
    (init?.integrity ?? request.integrity) ||
    (init?.keepalive ?? request.keepalive) ||
    (init?.referrerPolicy ?? request.referrerPolicy) ||
    !["about:client", ""].includes(request.referrer)
  )
    throw new TypeError("Legacy cancellation transport does not support this fetch policy.");
  // M63 accepts RequestInit.cache but does not expose Request.cache.
  const cache = init?.cache ?? request.cache ?? "default";
  if (!["default", "no-cache", "no-store", "reload"].includes(cache))
    throw new TypeError("Legacy cancellation transport does not support this cache policy.");
  if (typeof window !== "undefined") {
    const url = new URL(request.url);
    const sameOrigin = url.origin === window.location.origin;
    if (request.mode === "same-origin" && !sameOrigin)
      throw new TypeError("Cross-origin request refused by same-origin policy.");
    if (sameOrigin && /^https?:$/.test(url.protocol) && request.credentials === "omit")
      throw new TypeError("Legacy cancellation transport cannot omit same-origin cookies.");
  }
  return cache;
}

export function createAbortSignalFetch(
  original: typeof fetch,
  options: { nativeSignals?: boolean; createXHR?: () => XMLHttpRequest } = {},
): typeof fetch {
  if (options.nativeSignals ?? supportsNativeAbortFetch()) return original;
  const createXHR = options.createXHR ?? (() => new XMLHttpRequest());
  return function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
    const signal =
      init?.signal !== undefined
        ? init.signal
        : typeof Request !== "undefined" && input instanceof Request
          ? input.signal
          : undefined;
    if (!signal) return original.call(this, input, init);
    if (signal.aborted) return Promise.reject(aborted(signal));
    let request: Request;
    let cache: RequestCache;
    try {
      const cleanInit = { ...init };
      delete cleanInit.signal;
      request = new Request(input, cleanInit);
      cache = validateLegacyRequest(request, cleanInit);
    } catch (error) {
      return Promise.reject(error);
    }

    return new Promise<Response>((resolve, reject) => {
      let xhr: XMLHttpRequest | undefined;
      let done = false;
      const cleanup = () => {
        signal.removeEventListener("abort", onAbort);
        if (xhr) {
          xhr.onload = null;
          xhr.onerror = null;
          xhr.onabort = null;
          xhr.ontimeout = null;
        }
      };
      const finish = (error?: unknown, response?: Response) => {
        if (done) return;
        done = true;
        cleanup();
        if (response !== undefined) resolve(response);
        else reject(error);
      };
      const onAbort = () => {
        if (done) return;
        // Detach first: xhr.abort synchronously dispatches events on some engines.
        finish(aborted(signal));
        xhr?.abort();
      };
      signal.addEventListener("abort", onAbort);
      if (signal.aborted) {
        onAbort();
        return;
      }
      try {
        xhr = createXHR();
        xhr.open(request.method, request.url, true);
        if (done) return;
        xhr.responseType = "arraybuffer";
        xhr.withCredentials = request.credentials === "include";
        request.headers.forEach((value, name) => {
          xhr!.setRequestHeader(name, value);
        });
        if (cache !== "default") {
          xhr.setRequestHeader("Cache-Control", cache === "no-store" ? "no-store" : "no-cache");
          xhr.setRequestHeader("Pragma", "no-cache");
        }
        xhr.onerror = () => finish(new TypeError("Network request failed."));
        xhr.ontimeout = () => finish(new TypeError("Network request timed out."));
        xhr.onabort = () => finish(aborted(signal));
        xhr.onload = () => {
          if (done) return;
          try {
            const headers = new Headers();
            for (const line of xhr!.getAllResponseHeaders().split(/\r?\n/)) {
              const colon = line.indexOf(":");
              if (colon > 0)
                headers.append(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
            }
            const final = new URL(xhr!.responseURL || request.url);
            final.hash = "";
            // Successful local widget reads use status 0 in legacy XHR.
            const status = xhr!.status || (final.protocol === "file:" ? 200 : 0);
            const body =
              request.method === "HEAD" || [204, 205, 304].includes(status)
                ? null
                : xhr!.response;
            const response = new Response(body, {
              status,
              statusText: xhr!.statusText,
              headers,
            });
            const before = new URL(request.url);
            before.hash = "";
            finish(
              undefined,
              bindBody(response, signal, final.href, final.href !== before.href),
            );
          } catch (error) {
            finish(error);
          }
        };
        const send = (body?: XMLHttpRequestBodyInit | null) => {
          if (done) return;
          try {
            xhr!.send(body);
          } catch (error) {
            finish(error);
          }
        };
        if (request.method === "GET" || request.method === "HEAD") send();
        else request.arrayBuffer().then(send, (error) => finish(error));
      } catch (error) {
        finish(error);
      }
    });
  } as typeof fetch;
}
