import { useCallback, useEffect, useRef, useState } from "react";
import { configuredRelayUrl, saveRelayUrl } from "../services/remoteRelay";
import type { PairingSessionView } from "../services/deviceAccess";
import {
  cancelPairing,
  openPairing,
  remoteAccessState,
  startDevelopmentRemoteAccess,
  startRemoteAccess,
  stopRemoteAccess,
  subscribeRemoteAccess,
  type RemoteAccessState,
} from "../services/remoteServer";

export type RemoteAccessControl = RemoteAccessState & {
  openPairing: () => PairingSessionView | null;
  cancelPairing: () => void;
  retry: () => void;
  relayUrl?: string;
  configureRelay?: (url: string) => Promise<void>;
};

export function useRemoteAccess(enabled: boolean, development = false): RemoteAccessControl {
  const [state, setState] = useState(remoteAccessState);
  const [relayUrl, setRelayUrl] = useState(configuredRelayUrl);
  const lifecycle = useRef(0);
  const active = useRef(enabled);
  active.current = enabled;

  const begin = useCallback(() => {
    if (development && !configuredRelayUrl()) void startDevelopmentRemoteAccess();
    else startRemoteAccess();
  }, [development]);

  useEffect(() => subscribeRemoteAccess(setState), []);
  useEffect(() => {
    lifecycle.current += 1;
    if (enabled && !document.hidden) begin();
    else void stopRemoteAccess();
    return () => {
      lifecycle.current += 1;
      if (enabled) void stopRemoteAccess();
    };
  }, [enabled, begin]);

  useEffect(() => {
    if (!enabled) return;
    const visibility = () => {
      if (document.hidden) void stopRemoteAccess();
      else begin();
    };
    const stop = () => { void stopRemoteAccess(); };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", stop);
    window.addEventListener("pageshow", visibility);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", stop);
      window.removeEventListener("pageshow", visibility);
    };
  }, [enabled, begin]);

  const retry = useCallback(() => {
    const attempt = ++lifecycle.current;
    void stopRemoteAccess().then(() => {
      if (attempt === lifecycle.current && active.current && !document.hidden) begin();
    });
  }, [begin]);

  const configureRelay = useCallback(async (url: string) => {
    saveRelayUrl(url);
    setRelayUrl(configuredRelayUrl());
    const attempt = ++lifecycle.current;
    await stopRemoteAccess();
    if (attempt === lifecycle.current && active.current && !document.hidden) begin();
  }, [begin]);

  return { ...state, openPairing, cancelPairing, retry, relayUrl, configureRelay };
}
