'use client';

import { useEffect, useRef } from 'react';
import { useQrScanner } from '@/hooks/useQrScanner';

// Fullscreen camera overlay for reading the NFC-e QR code. Calls
// onScanned exactly once per scan with whatever the QR carried — the
// parent decides what to do with a non-SEFAZ value (the text stays in
// the URL field for manual correction, so the camera stopping is the
// right behavior either way).

export default function QrScannerModal({
  onScanned,
  onClose,
}: {
  onScanned: (text: string) => void;
  onClose: () => void;
}) {
  const { state, error, videoRef, start, stop } = useQrScanner();
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return; // StrictMode double-invocation guard
    startedRef.current = true;
    void start(onScanned);
    return () => stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Escanear QR code da nota"
      className="fixed inset-0 z-50 bg-black/90 flex flex-col"
    >
      <div className="relative flex-1 overflow-hidden">
        <video ref={videoRef} muted className="absolute inset-0 w-full h-full object-cover" />

        {/* QR frame guide */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="relative w-64 h-64 max-w-[70vw] max-h-[70vw]">
            <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-white rounded-tl-lg" />
            <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-white rounded-tr-lg" />
            <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-white rounded-bl-lg" />
            <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-white rounded-br-lg" />
          </div>
        </div>
      </div>

      <div className="p-4 pb-[max(1rem,env(safe-area-inset-bottom))] space-y-3 text-center">
        <p className="text-white text-sm font-medium">
          {state === 'error'
            ? error
            : 'Aponte a câmera para o QR code da nota fiscal'}
        </p>
        <button
          onClick={() => { stop(); onClose(); }}
          className="w-full max-w-xs mx-auto py-2.5 bg-white text-gray-900 rounded-lg text-sm font-bold active:scale-[0.98] transition-transform"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
