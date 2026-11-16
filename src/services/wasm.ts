/**
 * WebAssembly support detection for Tizen Smart TV engines.
 *
 * Tizen 3.0 (Chromium 47) completely lacks `window.WebAssembly`.
 * Tizen 4.0 (Chromium 56) has incomplete experimental WebAssembly flags.
 * Samsung documents WebAssembly support from Tizen 5.5 (Chromium 69).
 * Detect runtime capability; an engine version alone does not prove that
 * Samsung's separate socket host bindings exist in a worker. The outbound
 * remote relay uses native WebSocket/XHR and does not require WebAssembly.
 */
export const isWasmSupported = (): boolean => {
  try {
    return (
      typeof window !== "undefined" &&
      typeof window.WebAssembly !== "undefined" &&
      typeof window.WebAssembly.instantiate === "function"
    );
  } catch {
    return false;
  }
};
