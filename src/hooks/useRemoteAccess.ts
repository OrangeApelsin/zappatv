import { useCallback, useEffect, useState } from "react";
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
};

export function useRemoteAccess(enabled: boolean, development = false): RemoteAccessControl {
  const [state, setState] = useState(remoteAccessState);

  useEffect(() => subscribeRemoteAccess(setState), []);
  useEffect(() => {
    if (enabled && development) void startDevelopmentRemoteAccess();
    else if (enabled) startRemoteAccess();
    else void stopRemoteAccess();
    return () => {
      if (enabled) void stopRemoteAccess();
    };
  }, [enabled, development]);

  useEffect(() => {
    if (!enabled || development) return;
    const visibility = () => {
      if (document.hidden) void stopRemoteAccess();
      else startRemoteAccess();
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
  }, [enabled, development]);

  const retry = useCallback(() => {
    void stopRemoteAccess().then(() => {
      if (development) void startDevelopmentRemoteAccess();
      else startRemoteAccess();
    });
  }, [development]);

  return { ...state, openPairing, cancelPairing, retry };
}
