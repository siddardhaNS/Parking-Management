import { useCallback, useEffect, useState } from 'react';
import { api } from './api';

/** Minimal fetch-on-mount hook with manual reload. */
export function useFetch<T>(url: string | null) {
  const [data, setData] = useState<T | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    setLoading(true);
    api
      .get<T>(url)
      .then((d) => !cancelled && (setData(d), setError(null)))
      .catch((e: Error) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [url, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { data, error, loading, reload, setData };
}

/** Cache-busting live frame URL that changes whenever the camera reports a new frame. */
export function liveFrameUrl(cameraId: number, frameAt: number | undefined) {
  return frameAt ? `/api/cameras/${cameraId}/live.jpg?t=${frameAt}` : null;
}

/** Returns `src` only once it has finished loading, so frame swaps never flash blank. */
export function usePreloaded(src: string | null) {
  const [ready, setReady] = useState<string | null>(null);
  useEffect(() => {
    if (!src) return;
    const img = new Image();
    img.onload = () => setReady(src);
    img.src = src;
    return () => {
      img.onload = null;
    };
  }, [src]);
  return ready;
}
