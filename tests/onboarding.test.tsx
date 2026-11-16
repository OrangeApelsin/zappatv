import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Onboarding } from "../src/components/Onboarding";
import { Playlists } from "../src/components/settings/Playlists";
import { KEY } from "../src/hooks/useRemote";
import { useSettings } from "../src/stores/settings";
import { useSetup } from "../src/stores/setup";
import type { PlaylistSource } from "../src/services/playlistUrl";
import type { RemoteAccessState } from "../src/services/remoteServer";

beforeEach(() => {
  localStorage.clear();
  useSettings.getState().set("locale", "en");
  useSetup.getState().clear();
});

afterEach(cleanup);

test("renders tabbed setup modal with brand mark and 4 tabs", () => {
  render(<Onboarding onAdd={() => {}} onExit={() => {}} />);

  expect(screen.getByText("Zappa TV")).toBeTruthy();
  expect(screen.getByText("Add your playlist")).toBeTruthy();

  expect(screen.getByRole("button", { name: "From your phone" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "IPTV Manager (Token)" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Xtream login" })).toBeTruthy(); // Xtream Codes tab
  expect(screen.getByRole("button", { name: "M3U playlist" })).toBeTruthy(); // M3U tab
});

test("navigates across tabs and switches active content", () => {
  render(<Onboarding onAdd={() => {}} onExit={() => {}} />);

  const phoneTab = screen.getByRole("button", { name: "From your phone" });
  const tokenTab = screen.getByRole("button", { name: "IPTV Manager (Token)" });
  const xtreamTab = screen.getByRole("button", { name: "Xtream login" });
  const m3uTab = screen.getByRole("button", { name: "M3U playlist" });

  // Switch to Phone tab
  fireEvent.click(phoneTab);
  expect(phoneTab.getAttribute("aria-pressed")).toBe("true");
  expect(document.querySelector("#pair-code")).toBeTruthy();
  expect(screen.getByText("Scan this code with the camera on your phone.")).toBeTruthy();

  // Switch to Token tab
  fireEvent.click(tokenTab);
  expect(tokenTab.getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByLabelText("Client token")).toBeTruthy();

  // Switch to Xtream tab
  fireEvent.click(xtreamTab);
  expect(xtreamTab.getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByLabelText("Username")).toBeTruthy();
  expect(screen.getByLabelText("Password")).toBeTruthy();

  // Switch to M3U tab
  fireEvent.click(m3uTab);
  expect(m3uTab.getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByLabelText("Playlist address")).toBeTruthy();
});

test("From your phone tab displays inline 340x340 QR canvas and live status", () => {
  const remoteAccess: RemoteAccessState = {
    status: "listening",
    address: "192.168.1.100",
    port: 8080,
    remotePath: "/remote",
    pairing: { secret: "sec123", code: "789012", expiresAt: Date.now() + 300_000 },
    pairingError: false,
    connectedDevice: "",
    error: "",
  };

  const openPairing = vi.fn();
  render(
    <Onboarding
      onAdd={() => {}}
      onExit={() => {}}
      remoteAccess={remoteAccess}
      onOpenPairing={openPairing}
      showRemoteSetup
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "From your phone" }));

  const canvas = document.querySelector("#pair-qr") as HTMLCanvasElement;
  expect(canvas).toBeTruthy();
  expect(canvas.getAttribute("width")).toBe("340");
  expect(canvas.getAttribute("height")).toBe("340");

  expect(screen.getByText("789 012")).toBeTruthy();
  expect(screen.getByText("http://192.168.1.100:8080/remote")).toBeTruthy();
  expect(screen.getByRole("status").textContent).toContain("Waiting for phone…");
});

test("IPTV Manager Token quick connect validates and submits single-token", () => {
  const added: { name: string; source: PlaylistSource }[] = [];
  render(
    <Onboarding onAdd={(name, source) => added.push({ name, source })} onExit={() => {}} />,
  );

  fireEvent.click(screen.getByRole("button", { name: "IPTV Manager (Token)" }));

  // Missing token should show error
  fireEvent.click(screen.getByRole("button", { name: "Add a playlist" }));
  expect(screen.getByRole("alert").textContent).toBeTruthy();
  expect(added).toHaveLength(0);

  // Type token and custom server
  fireEvent.change(screen.getByLabelText("Client token"), {
    target: { value: "test-token-abc" },
  });
  fireEvent.change(screen.getByLabelText("Server address"), {
    target: { value: "http://tv.example.com:8000" },
  });
  fireEvent.change(screen.getByLabelText("Name it (optional)"), {
    target: { value: "My IPTV Manager" },
  });

  fireEvent.click(screen.getByRole("button", { name: "Add a playlist" }));

  expect(added).toHaveLength(1);
  expect(added[0]).toEqual({
    name: "My IPTV Manager",
    source: {
      kind: "xtream",
      server: "http://tv.example.com:8000",
      username: "test-token-abc",
      password: "test-token-abc",
      token: "test-token-abc",
      output: "ts",
    },
  });
});

test("M3U shortcut chips append text and clear input", () => {
  render(<Onboarding onAdd={() => {}} onExit={() => {}} />);

  const urlInput = screen.getByLabelText("Playlist address") as HTMLInputElement;

  fireEvent.click(screen.getByRole("button", { name: "https://" }));
  expect(urlInput.value).toBe("https://");

  fireEvent.click(screen.getByRole("button", { name: "Clear" }));
  expect(urlInput.value).toBe("");

  fireEvent.click(screen.getByRole("button", { name: "http://" }));
  expect(urlInput.value).toBe("http://");

  fireEvent.change(urlInput, { target: { value: "http://myprovider" } });
  fireEvent.click(screen.getByRole("button", { name: ".com" }));
  expect(urlInput.value).toBe("http://myprovider.com");

  fireEvent.click(screen.getByRole("button", { name: "/get.php?username=" }));
  expect(urlInput.value).toBe("http://myprovider.com/get.php?username=");

  // Clear button resets
  fireEvent.click(screen.getByRole("button", { name: "Clear" }));
  expect(urlInput.value).toBe("");
});

test("shows graceful guidance on phone tab when remote access is unavailable", () => {
  const unavailableState: RemoteAccessState = {
    status: "unavailable",
    address: "",
    port: 0,
    remotePath: "",
    pairing: null,
    pairingError: false,
    connectedDevice: "",
    error: "WebAssembly is not supported on this TV model",
  };

  render(
    <Onboarding
      onAdd={() => {}}
      onExit={() => {}}
      remoteAccess={unavailableState}
      showRemoteSetup={true}
    />,
  );

  const phoneTab = screen.getByRole("button", { name: "From your phone" });
  fireEvent.click(phoneTab);

  expect(
    screen.getByText(
      "You can still enter the playlist on the left.",
    ),
  ).toBeTruthy();
  expect(document.querySelector("#pair-code.blank")).toBeTruthy();

  // Clicking the button switches to token tab
  const tokenBtn = screen.getAllByRole("button", { name: "IPTV Manager (Token)" })[1];
  fireEvent.click(tokenBtn);
  expect(screen.getByLabelText("Client token")).toBeTruthy();
});

test("Return key exits when not typing in input", () => {
  const onExit = vi.fn();
  render(<Onboarding onAdd={() => {}} onExit={onExit} />);

  // When focused on button, Return calls onExit
  const m3uTab = screen.getByRole("button", { name: "M3U playlist" });
  m3uTab.focus();

  fireEvent.keyDown(window, { keyCode: KEY.BACK });
  expect(onExit).toHaveBeenCalledTimes(1);
});

test("IPTV Manager Token server address is a placeholder rather than actual text value (TICKET-2197)", () => {
  render(<Onboarding onAdd={() => {}} onExit={() => {}} />);
  const tokenTab = screen.getByRole("button", { name: "IPTV Manager (Token)" });
  fireEvent.click(tokenTab);

  const serverInput = screen.getByLabelText("Server address") as HTMLInputElement;
  expect(serverInput.value).toBe("");
  expect(serverInput.placeholder).toBe("http://provider.example:8000");
});

test("Playlists settings: adding IPTV Manager token playlist shows server placeholder rather than value (TICKET-2197)", () => {
  const navigation = {
    open: vi.fn(),
    close: vi.fn(),
    current: null,
  };
  render(<Playlists onAsking={() => {}} navigation={navigation} />);

  // Click Add Playlist button
  const addBtn = screen.getByRole("button", { name: "Add a playlist" });
  fireEvent.click(addBtn);

  // Switch to IPTV Manager (Token)
  const tokenBtn = screen.getByRole("button", { name: "IPTV Manager (Token)" });
  fireEvent.click(tokenBtn);

  // Check the Server Address input in the add playlist view
  const serverInput = document.querySelector("#pl-server") as HTMLInputElement;
  expect(serverInput.value).toBe("");
  expect(serverInput.placeholder).toBe("http://provider.example:8000");
});
