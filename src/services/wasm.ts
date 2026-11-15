/**
 * WebAssembly support detection for Tizen Smart TV engines.
 *
 * Tizen 3.0 (Chromium 47) completely lacks `window.WebAssembly`.
 * Tizen 4.0 (Chromium 56) has incomplete experimental WebAssembly flags.
 * Tizen 5.0+ (Chromium 69+) natively supports standard `WebAssembly.instantiate`.
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
