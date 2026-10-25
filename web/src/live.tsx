import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { CameraLive, LotSummary } from './api';

interface LiveState {
  cameras: Record<number, CameraLive>;
  lots: Record<number, LotSummary>;
  connected: boolean;
}

const LiveContext = createContext<LiveState>({ cameras: {}, lots: {}, connected: false });

/** One shared WebSocket for the whole dashboard; reconnects with backoff. */
export function LiveProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<LiveState>({ cameras: {}, lots: {}, connected: false });

  useEffect(() => {
    let ws: WebSocket | null = null;
    let retry = 1000;
    let timer: number | undefined;
    let closed = false;

    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${location.host}/api/ws`);
      ws.onopen = () => {
        retry = 1000;
        setState((s) => ({ ...s, connected: true }));
      };
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data as string);
        if (msg.type === 'camera') {
          setState((s) => ({ ...s, cameras: { ...s.cameras, [msg.data.cameraId]: msg.data } }));
        } else if (msg.type === 'lot') {
          setState((s) => ({ ...s, lots: { ...s.lots, [msg.data.lotId]: msg.data } }));
        }
      };
      ws.onclose = () => {
        setState((s) => ({ ...s, connected: false }));
        if (closed) return;
        timer = window.setTimeout(connect, retry);
        retry = Math.min(retry * 2, 15_000);
      };
    };
    connect();
    return () => {
      closed = true;
      window.clearTimeout(timer);
      ws?.close();
    };
  }, []);

  return <LiveContext.Provider value={state}>{children}</LiveContext.Provider>;
}

export const useLive = () => useContext(LiveContext);
export const useCameraLive = (id: number | undefined) => {
  const { cameras } = useLive();
  return id === undefined ? undefined : cameras[id];
};
