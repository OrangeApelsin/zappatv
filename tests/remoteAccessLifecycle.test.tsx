import { act, renderHook, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const service = vi.hoisted(() => ({
  start: vi.fn(), stop: vi.fn(() => Promise.resolve()), development: vi.fn(),
  state: { status: "idle", address: "", port: 0, remotePath: "", pairing: null, pairingError: false, connectedDevice: "", error: "" },
}));
vi.mock("../src/services/remoteServer", () => ({
  remoteAccessState: () => service.state,
  subscribeRemoteAccess: () => () => {},
  startRemoteAccess: service.start, stopRemoteAccess: service.stop,
  startDevelopmentRemoteAccess: service.development,
  openPairing: vi.fn(), cancelPairing: vi.fn(),
}));
import { useRemoteAccess } from "../src/hooks/useRemoteAccess";

let hidden = false;
beforeEach(() => {
  localStorage.clear(); hidden = false;
  service.start.mockClear(); service.stop.mockReset().mockResolvedValue(); service.development.mockClear();
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

test("suspend stops transport and resume reopens exactly once", async () => {
  renderHook(() => useRemoteAccess(true));
  expect(service.start).toHaveBeenCalledTimes(1);
  act(() => { hidden = true; document.dispatchEvent(new Event("visibilitychange")); });
  expect(service.stop).toHaveBeenCalledTimes(1);
  act(() => { hidden = false; document.dispatchEvent(new Event("visibilitychange")); });
  expect(service.start).toHaveBeenCalledTimes(2);
});

test("a pending retry cannot restart the service after unmount", async () => {
  let release: () => void = () => {};
  service.stop.mockImplementation(() => new Promise<void>((resolve) => { release = resolve; }));
  const hook = renderHook(() => useRemoteAccess(true));
  act(() => hook.result.current.retry());
  const retryDone = release;
  hook.unmount();
  await act(async () => retryDone());
  expect(service.start).toHaveBeenCalledTimes(1);
});

test("configuring a relay in development selects the outbound client instead of the old bridge", async () => {
  const hook = renderHook(() => useRemoteAccess(true, true));
  expect(service.development).toHaveBeenCalledTimes(1);
  await act(async () => { await hook.result.current.configureRelay?.("https://relay.test/prefix"); });
  expect(service.start).toHaveBeenCalledTimes(1);
  expect(hook.result.current.relayUrl).toBe("https://relay.test/prefix/");
});
