'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// Camera lifecycle + QR decode loop for the receipt QR scanner. jsQR is
// dynamically imported at scan time: the ~250 KB decoder stays out of the
// initial bundle and only browsers that actually scan pay for it. There is
// no test runner for this (browser APIs); the URL allowlist it feeds is
// what carries the unit tests (tests/sefaz-url.test.ts).

export type ScanState = 'idle' | 'scanning' | 'error';

interface JsQrModule {
  default: (
    data: Uint8ClampedArray,
    width: number,
    height: number,
    options?: { inversionAttempts?: 'dontInvert' | 'onlyInvert' | 'attemptBoth' }
  ) => { data: string } | null;
}

// getUserMedia error names → user-facing pt-BR messages.
function cameraErrorMessage(err: unknown): string {
  const name = err instanceof DOMException ? err.name : '';
  switch (name) {
    case 'NotAllowedError':
      return 'Acesso à câmera negado. Permita o uso da câmera nas configurações do navegador e tente novamente.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'Nenhuma câmera encontrada neste dispositivo.';
    case 'NotReadableError':
      return 'A câmera está em uso por outro aplicativo.';
    default:
      return 'Não foi possível acessar a câmera neste navegador.';
  }
}

export function useQrScanner() {
  const [state, setState] = useState<ScanState>('idle');
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    setState('idle');
  }, []);

  // Every exit path (manual stop, unmount, successful scan) must kill the
  // track, or the camera indicator stays on after the modal is gone.
  useEffect(() => stop, [stop]);

  const start = useCallback(async (onScanned: (text: string) => void) => {
    setError(null);
    setState('scanning');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      streamRef.current = stream;

      const video = videoRef.current;
      if (!video) throw new Error('video element missing');
      video.srcObject = stream;
      // Without playsInline, iOS Safari opens fullscreen and never returns.
      video.playsInline = true;
      await video.play();

      const jsQR = (await import('jsqr')) as unknown as JsQrModule;
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('canvas 2d context unavailable');

      const tick = () => {
        if (!streamRef.current) return; // stopped mid-frame
        if (video.readyState === video.HAVE_ENOUGH_DATA) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          if (canvas.width > 0 && canvas.height > 0) {
            ctx.drawImage(video, 0, 0);
            const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR.default(frame.data, canvas.width, canvas.height, {
              inversionAttempts: 'dontInvert',
            });
            if (code) {
              stop();
              onScanned(code.data);
              return;
            }
          }
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch (err) {
      stop();
      setError(cameraErrorMessage(err));
      setState('error');
    }
  }, [stop]);

  return { state, error, videoRef, start, stop };
}
