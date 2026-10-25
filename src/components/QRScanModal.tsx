import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { Camera, Keyboard, X, RefreshCw } from 'lucide-react';
import { cleanCode, isCheckInCode, parseCheckIn } from '../lib/checkin';

// The app's own QR scanner. Many budget phones have a camera app with no QR
// reader, so customers can scan from inside WashFlow instead, or type the
// 6-character code printed under the QR.
//
// It hands back either the station code or (for old posters) the station id.
export default function QRScanModal({ onFound, onClose }: { onFound: (stationRef: string) => void; onClose: () => void }) {
  const [mode, setMode] = useState<'scan' | 'type'>('scan');
  const [camError, setCamError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);
  const [notOurs, setNotOurs] = useState(false);
  const [typed, setTyped] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (mode !== 'scan') return;
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    const Detector: any = (window as any).BarcodeDetector;
    let detector: any = null;

    const finish = (text: string) => {
      const ref = parseCheckIn(text);
      if (!ref) { setNotOurs(true); return false; }
      stopped = true;
      if (navigator.vibrate) navigator.vibrate(80);
      onFound('code' in ref ? ref.code : ref.id);
      return true;
    };

    const tick = async () => {
      if (stopped) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
        try {
          if (detector) {
            const codes = await detector.detect(video);
            if (codes?.length && finish(codes[0].rawValue)) return;
          } else {
            // Scan a centred square, scaled down: much faster on slow phones.
            const side = Math.min(video.videoWidth, video.videoHeight);
            const size = Math.min(side, 640);
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
            ctx.drawImage(video, (video.videoWidth - side) / 2, (video.videoHeight - side) / 2, side, side, 0, 0, size, size);
            const img = ctx.getImageData(0, 0, size, size);
            const hit = jsQR(img.data, size, size, { inversionAttempts: 'attemptBoth' });
            if (hit?.data && finish(hit.data)) return;
          }
        } catch { /* keep scanning */ }
      }
      raf = requestAnimationFrame(tick);
    };

    (async () => {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setCamError('The camera only works when the app is opened over https. Type the code instead.');
        setStarting(false);
        return;
      }
      try {
        if (Detector) {
          try {
            const formats = await Detector.getSupportedFormats?.();
            if (!formats || formats.includes('qr_code')) detector = new Detector({ formats: ['qr_code'] });
          } catch { detector = null; }
        }
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
        const video = videoRef.current!;
        video.srcObject = stream;
        video.setAttribute('playsinline', 'true');   // iPhone: play inside the page, not fullscreen
        await video.play();
        setStarting(false);
        raf = requestAnimationFrame(tick);
      } catch (e: any) {
        setStarting(false);
        setCamError(e?.name === 'NotAllowedError'
          ? 'Camera permission was refused. Allow the camera for this site in your browser settings, or type the code.'
          : 'Could not open the camera on this phone. Type the code printed under the QR instead.');
      }
    })();

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [mode]);

  const code = cleanCode(typed);
  const validTyped = isCheckInCode(code);
  const submitTyped = () => { if (validTyped) onFound(code); };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-bg/80 backdrop-blur-md" onClick={onClose} />
      <div className="relative w-full max-w-md bg-card border border-border p-6 rounded-[2.5rem] shadow-2xl space-y-5">
        <button onClick={onClose} className="absolute top-5 right-5 text-text-dim hover:text-text-main" aria-label="Close"><X size={20} /></button>
        <h2 className="text-2xl font-black text-text-main uppercase tracking-tighter">Check in at a station</h2>

        <div className="flex gap-2">
          <button onClick={() => setMode('scan')} className={`flex-1 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest border flex items-center justify-center gap-2 ${mode === 'scan' ? 'bg-accent text-white border-accent' : 'border-border text-text-dim'}`}>
            <Camera size={14} /> Scan QR
          </button>
          <button onClick={() => setMode('type')} className={`flex-1 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest border flex items-center justify-center gap-2 ${mode === 'type' ? 'bg-accent text-white border-accent' : 'border-border text-text-dim'}`}>
            <Keyboard size={14} /> Enter code
          </button>
        </div>

        {mode === 'scan' ? (
          camError ? (
            <div className="space-y-4">
              <p className="text-sm text-text-main font-bold">{camError}</p>
              <button onClick={() => setMode('type')} className="w-full bg-accent text-white font-black py-3 rounded-xl uppercase tracking-widest text-xs">Type the code</button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="relative w-full aspect-square bg-black rounded-2xl overflow-hidden">
                <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
                <div className="absolute inset-[15%] border-4 border-white/80 rounded-2xl pointer-events-none" />
                {starting && (
                  <div className="absolute inset-0 flex items-center justify-center text-white text-sm gap-2">
                    <RefreshCw size={16} className="animate-spin" /> Starting camera…
                  </div>
                )}
              </div>
              <canvas ref={canvasRef} className="hidden" />
              <p className="text-xs text-text-dim text-center">
                Point the camera at the QR code on the station's poster. Hold steady, about an arm's length away.
              </p>
              {notOurs && <p className="text-xs text-amber-500 font-bold text-center">That QR code is not a WashFlow station code. Try the poster at the entrance.</p>}
            </div>
          )
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-text-main font-bold">Type the 6-character code printed under the station's QR code.</p>
            <input
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === 'Enter' && submitTyped()}
              maxLength={10}
              placeholder="e.g. K7M2QX"
              className="w-full bg-bg border border-border rounded-xl px-4 py-4 text-center text-2xl tracking-[0.4em] text-text-main font-black outline-none focus:ring-2 focus:ring-accent uppercase"
              autoCapitalize="characters"
              autoComplete="off"
            />
            {typed && !validTyped && <p className="text-xs text-text-dim text-center">Codes have 6 letters and numbers, without O, 0, I, 1 or L.</p>}
            <button onClick={submitTyped} disabled={!validTyped} className="w-full bg-accent text-white font-black py-4 rounded-xl uppercase tracking-widest text-xs disabled:opacity-40">
              Continue
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
