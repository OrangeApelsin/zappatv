import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { RelayConfiguration } from "../src/components/RelayConfiguration";
import { RemoteSetup } from "../src/components/RemoteSetup";
import { Onboarding } from "../src/components/Onboarding";
import { useSettings } from "../src/stores/settings";
import type { RemoteAccessState } from "../src/services/remoteServer";

beforeEach(() => { localStorage.clear(); useSettings.getState().set("locale", "en"); });
afterEach(cleanup);

test("invalid relay URLs stay local and restore focus with an accessible error", async () => {
  const save = vi.fn(); render(<RelayConfiguration value="" onSave={save} />);
  const input = screen.getByLabelText("Remote relay URL (HTTPS)");
  fireEvent.change(input, { target: { value: "http://insecure.test" } });
  fireEvent.submit(input.closest("form") as HTMLFormElement);
  expect(screen.getByRole("alert").textContent).toContain("HTTPS");
  expect(document.activeElement).toBe(input); expect(save).not.toHaveBeenCalled();
});

test("save normalizes prefixes, reports success and leaves existing TV data untouched", async () => {
  const save = vi.fn(async () => {});
  localStorage.setItem("openiptv.devices", "retained-devices");
  render(<RelayConfiguration value="" onSave={save} />);
  const input = screen.getByLabelText("Remote relay URL (HTTPS)");
  fireEvent.change(input, { target: { value: "https://RELAY.test/prefix" } });
  fireEvent.submit(input.closest("form") as HTMLFormElement);
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain("saved"));
  expect(save).toHaveBeenCalledWith("https://relay.test/prefix/");
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Save" }));
  expect(localStorage.getItem("openiptv.devices")).toBe("retained-devices");
});

test("failed storage leaves the draft available and displays the specific error", async () => {
  render(<RelayConfiguration value="https://relay.test/" onSave={async () => { throw new Error("quota"); }} />);
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("storage"));
  expect((screen.getByLabelText("Remote relay URL (HTTPS)") as HTMLInputElement).value).toBe("https://relay.test/");
});

const state: RemoteAccessState = { status: "listening", phoneUrl: "https://relay.test/prefix/t/tv-one/",
  address: "", port: 0, remotePath: "", pairing: { secret: "private", code: "123456", expiresAt: Date.now() + 300000 },
  error: "", pairingError: false, connectedDevice: "" };

test("QR and manual address use the transport URL and disappear on disconnection", () => {
  const view = render(<RemoteSetup remoteAccess={state} />);
  expect(screen.getByText("https://relay.test/prefix/t/tv-one/")).toBeTruthy();
  expect(document.querySelector(".remote-qr svg")).toBeTruthy();
  view.rerender(<RemoteSetup remoteAccess={{ ...state, status: "unavailable", errorKey: "remote.relayOffline" }} />);
  expect(document.querySelector(".remote-qr")).toBeNull();
  expect(screen.getByRole("alert").textContent).toContain("reconnect");
});

test("onboarding cancellation does not immediately open another pairing session", () => {
  const open = vi.fn(); const cancel = vi.fn();
  const props = { onAdd: vi.fn(), onExit: vi.fn(), showRemoteSetup: true, onOpenPairing: open, onCancelPairing: cancel };
  const view = render(<Onboarding {...props} remoteAccess={state} />);
  fireEvent.click(screen.getByRole("button", { name: "Cancel pairing" })); expect(cancel).toHaveBeenCalledTimes(1);
  view.rerender(<Onboarding {...props} remoteAccess={{ ...state, pairing: null }} />);
  expect(open).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Try again" })); expect(open).toHaveBeenCalledTimes(1);
});

test.each(["sv", "ar"] as const)("relay configuration has translated controls in %s", (locale) => {
  useSettings.getState().set("locale", locale);
  render(<RelayConfiguration value="" onSave={async () => {}} />);
  expect(screen.queryByText("Remote relay URL (HTTPS)")).toBeNull();
  expect(screen.getByRole("button").textContent).not.toBe("Save");
});
