'use client';

import { useEffect, useRef } from 'react';
import { useQrScanner } from '@/hooks/useQrScanner';

// Fullscreen camera overlay for reading the NFC-e QR code. Calls
// onScanned exactly once per scan with whatever the QR carried — the
// parent decides what to do with a non-SEFAZ value (the text stays in
// the URL field for manual correction, so the camera stopping is the
// right behavior either way).

// The overlay draws on top of a live video feed, not on an app surface: white on
// near-black is correct in both palettes, so these are the app's only raw palette
// classes. tests/design-tokens.test.ts allows them between the markers and nowhere else.
// design-tokens: allow
const BACKDROP = 'bg-black/90';
const GUIDE = 'border-white';
const CAPTION = 'text-white';
// design-tokens: end

export default function QrScannerModal({
  onScanned,
  onClose,
}: {
  onScanned: (text: string) => void;
  onClose: () => void;
}) {
  const { state, error, videoRef, start, stop } = useQrScanner();

  // StrictMode double-invokes effects in dev: first mount starts the camera
  // and its cleanup stops it, the second mount must start it again — a
  // "run once" ref here would leave the modal with a dead stream.
  const onScannedRef = useRef(onScanned);
  useEffect(() => {
    onScannedRef.current = onScanned;
  }, [onScanned]);

  useEffect(() => {
    void start((text: string) => onScannedRef.current(text));
    return () => stop();
  }, [start, stop]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Escanear QR code da nota"
      className={`fixed inset-0 z-50 ${BACKDROP} flex flex-col`}
    >
      <div className="relative flex-1 overflow-hidden">
        <video ref={videoRef} muted className="absolute inset-0 w-full h-full object-cover" />

        {/* QR frame guide */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="relative w-64 h-64 max-w-[70vw] max-h-[70vw]">
            <div className={`absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 ${GUIDE} rounded-tl-lg`} />
            <div className={`absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 ${GUIDE} rounded-tr-lg`} />
            <div className={`absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 ${GUIDE} rounded-bl-lg`} />
            <div className={`absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 ${GUIDE} rounded-br-lg`} />
          </div>
        </div>
      </div>

      <div className="p-4 pb-[max(1rem,env(safe-area-inset-bottom))] space-y-3 text-center">
        <p className={`${CAPTION} text-sm font-medium`}>
          {state === 'error'
            ? error
            : 'Aponte a câmera para o QR code da nota fiscal'}
        </p>
        <button
          onClick={() => { stop(); onClose(); }}
          className="w-full max-w-xs mx-auto py-2.5 bg-surface-1 text-ink rounded-lg text-sm font-bold active:scale-[0.98] transition-transform"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
