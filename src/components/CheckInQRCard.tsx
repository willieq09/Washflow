import { useEffect, useRef, useState } from 'react';
import { QRCodeCanvas, QRCodeSVG } from 'qrcode.react';
import { collection, doc, getDocs, onSnapshot, query, updateDoc, where, limit } from 'firebase/firestore';
import { QrCode, Download, Printer, Copy, AlertTriangle, RefreshCw } from 'lucide-react';
import { db } from '../lib/firebase';
import { checkInLink, isCheckInCode, isLocalAddress, makeCheckInCode } from '../lib/checkin';

// Shown to station owners in Settings.
//
// Why phones were not scanning the old QR code, and what changed:
//   1. It held a long link (?checkin=<20-character id>), so the QR had many tiny
//      squares. It now holds a short link (?c=<6-character code>): fewer, bigger
//      squares that cheap and older cameras read easily.
//   2. The downloaded/printed image had almost no white border ("quiet zone").
//      Cameras need about 4 squares of white all round to find the code.
//   3. The print poster stretched a small 200px picture, so the edges were blurry.
//      It now prints a sharp vector QR, and the download is 1200px.
//   4. On a laptop running the app locally the QR pointed at http://localhost,
//      which no phone can open. The card now warns about that.
//   5. Some phones' cameras simply have no QR reader. The poster shows the code in
//      big letters so customers can type it in the app (Check in > Enter code), and
//      the app has its own scanner that works on any phone.
export default function CheckInQRCard({ ownerUid }: { ownerUid: string }) {
  const [business, setBusiness] = useState<{ id: string; name: string; code?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const svgWrap = useRef<HTMLDivElement>(null);
  const bigWrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = query(collection(db, 'wash_businesses'), where('ownerUid', '==', ownerUid), limit(1));
    return onSnapshot(
      q,
      (snap) => {
        if (snap.empty) setBusiness(null);
        else {
          const d = snap.docs[0];
          setBusiness({ id: d.id, name: d.data().name || 'Your Station', code: d.data().checkInCode });
        }
        setLoading(false);
      },
      () => setLoading(false)
    );
  }, [ownerUid]);

  // Give the station its short code the first time this card is shown.
  useEffect(() => {
    if (!business || isCheckInCode(business.code || '') || creating) return;
    setCreating(true);
    (async () => {
      try {
        for (let attempt = 0; attempt < 5; attempt++) {
          const code = makeCheckInCode();
          const taken = await getDocs(query(collection(db, 'wash_businesses'), where('checkInCode', '==', code), limit(1)));
          if (taken.empty) {
            await updateDoc(doc(db, 'wash_businesses', business.id), { checkInCode: code });
            return;
          }
        }
        setError('Could not create a check-in code. Refresh the page to try again.');
      } catch (e: any) {
        setError(`Could not create a check-in code: ${e?.message || e}`);
      } finally {
        setCreating(false);
      }
    })();
  }, [business?.id, business?.code]);

  const code = business && isCheckInCode(business.code || '') ? business.code! : '';
  const link = code ? checkInLink(code) : '';
  const local = !!link && isLocalAddress(link);
  const fileName = `${(business?.name || 'station').replace(/\s+/g, '-').toLowerCase()}-checkin-qr.png`;

  // Download: a large PNG with a white border, plus the code written underneath.
  const download = () => {
    const qr = bigWrap.current?.querySelector('canvas');
    if (!qr || !business) return;
    const pad = 60, textH = 200;
    const out = document.createElement('canvas');
    out.width = qr.width + pad * 2;
    out.height = qr.height + pad * 2 + textH;
    const ctx = out.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(qr, pad, pad);
    ctx.fillStyle = '#000000';
    ctx.textAlign = 'center';
    ctx.font = 'bold 44px system-ui, sans-serif';
    ctx.fillText('Code: ' + code.split('').join(' '), out.width / 2, qr.height + pad + 90);
    ctx.font = '30px system-ui, sans-serif';
    ctx.fillText(business.name, out.width / 2, qr.height + pad + 150);
    const a = document.createElement('a');
    a.href = out.toDataURL('image/png');
    a.download = fileName;
    a.click();
  };

  // Print: a sharp vector QR, about 11 cm wide, with instructions and the typed-code fallback.
  const print = () => {
    const svg = svgWrap.current?.querySelector('svg');
    if (!svg || !business) return;
    const w = window.open('', '_blank');
    if (!w) { alert('Allow pop-ups for this site to print the poster.'); return; }
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Check-in QR</title>
      <style>
        @page { size: A4; margin: 15mm; }
        body { font-family: system-ui, sans-serif; text-align: center; color: #000; margin: 0; }
        h1 { font-size: 34pt; margin: 0 0 4mm; }
        .lead { font-size: 18pt; margin: 0; }
        .qr { width: 110mm; height: 110mm; margin: 10mm auto 6mm; }
        .qr svg { width: 100%; height: 100%; display: block; }
        .code { font-size: 30pt; font-weight: 800; letter-spacing: 6pt; border: 2px solid #000; display: inline-block; padding: 3mm 8mm; border-radius: 4mm; }
        .steps { font-size: 13pt; margin: 8mm auto 0; max-width: 150mm; text-align: left; line-height: 1.6; }
        .link { font-size: 11pt; color: #444; margin-top: 6mm; word-break: break-all; }
      </style></head><body>
      <h1>${esc(business.name)}</h1>
      <p class="lead">Scan with your phone camera to check in</p>
      <div class="qr">${svg.outerHTML}</div>
      <div class="code">${esc(code)}</div>
      <div class="steps">
        <b>Camera won't scan?</b><br>
        1. Open the WashFlow app and sign in.<br>
        2. Tap <b>Check in at a station</b>.<br>
        3. Tap <b>Scan QR</b>, or type the code <b>${esc(code)}</b>.
      </div>
      <div class="link">${esc(link)}</div>
      <script>window.onload=function(){setTimeout(function(){window.print()},300)}</script>
      </body></html>`);
    w.document.close();
  };

  return (
    <div className="bg-card border border-border rounded-[2.5rem] p-8 md:p-12 space-y-6 shadow-2xl">
      <label className="text-xs md:text-sm font-black text-accent uppercase tracking-[0.25em] flex items-center gap-3">
        <QrCode size={20} className="text-accent" /> Check-in QR Code
      </label>

      {loading ? (
        <p className="text-sm text-text-dim">Loading…</p>
      ) : !business ? (
        <p className="text-sm text-text-main font-bold">
          Fill in your business details above and press Commit Settings. Your QR code will appear here once the station is saved.
        </p>
      ) : error ? (
        <p className="text-sm text-red-500 font-bold">{error}</p>
      ) : !code ? (
        <p className="text-sm text-text-dim flex items-center gap-2"><RefreshCw size={16} className="animate-spin" /> Creating your check-in code…</p>
      ) : (
        <>
          {local && (
            <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-600 text-sm font-bold flex gap-3">
              <AlertTriangle size={20} className="shrink-0" />
              <span>
                This QR points to <b>{new URL(link).host}</b>, which only works on this computer. Phones will scan it but open nothing.
                Open WashFlow from its live address (for example your Vercel link) before printing, or set VITE_PUBLIC_APP_URL.
              </span>
            </div>
          )}
          <div className="flex flex-col md:flex-row gap-8 items-center">
            {/* White background and a 4-square border are part of the code itself, so cameras can find it. */}
            <div ref={svgWrap} className="bg-white p-3 rounded-2xl shrink-0">
              <QRCodeSVG value={link} size={220} marginSize={4} level="M" bgColor="#FFFFFF" fgColor="#000000" />
            </div>
            {/* Hidden large copy used for the PNG download. */}
            <div ref={bigWrap} style={{ position: 'absolute', left: -99999, top: 0 }} aria-hidden="true">
              <QRCodeCanvas value={link} size={1200} marginSize={4} level="M" bgColor="#FFFFFF" fgColor="#000000" />
            </div>
            <div className="space-y-4 w-full">
              <div>
                <p className="text-[10px] font-black text-text-dim uppercase tracking-widest">Station check-in code</p>
                <p className="text-4xl font-black text-text-main tracking-[0.3em]">{code}</p>
              </div>
              <p className="text-sm text-text-main font-bold leading-relaxed">
                Print this and place it where customers arrive. Customers whose camera can't scan can type the code in the app.
              </p>
              <div className="flex flex-wrap gap-3">
                <button onClick={print} className="px-5 py-3 bg-accent text-white rounded-xl font-black text-[10px] uppercase tracking-widest flex items-center gap-2">
                  <Printer size={14} /> Print Poster
                </button>
                <button onClick={download} className="px-5 py-3 bg-bg border border-border text-text-main rounded-xl font-black text-[10px] uppercase tracking-widest flex items-center gap-2">
                  <Download size={14} /> Download PNG
                </button>
                <button
                  onClick={() => { navigator.clipboard?.writeText(link); alert('Check-in link copied.'); }}
                  className="px-5 py-3 bg-bg border border-border text-text-main rounded-xl font-black text-[10px] uppercase tracking-widest flex items-center gap-2"
                >
                  <Copy size={14} /> Copy Link
                </button>
              </div>
              <p className="text-xs text-text-dim break-all">{link}</p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
