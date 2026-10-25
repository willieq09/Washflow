// QR check-in helpers.
//
// Every station gets a short 6-character CHECK-IN CODE (for example K7M2QX).
// The QR code on the poster holds a short link with that code:
//     https://your-app.com/?c=K7M2QX
// A short link makes a QR code with fewer, bigger squares, which cheap and
// older phone cameras read far more reliably than a long link.
//
// The same code is printed in big letters under the QR code, so a customer
// whose camera cannot scan can type it in the app instead.

// No 0/O, 1/I/L, so people can't mistype it.
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;

export function makeCheckInCode(random: () => number = Math.random): string {
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) out += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  return out;
}

export function isCheckInCode(value: string): boolean {
  if (!value || value.length !== CODE_LENGTH) return false;
  for (const ch of value) if (!CODE_ALPHABET.includes(ch)) return false;
  return true;
}

// A Firestore document id: 20 letters/digits. Used by older posters (?checkin=<id>).
export function isStationId(value: string): boolean {
  return /^[A-Za-z0-9]{15,40}$/.test(value || '');
}

export type StationRef = { code: string } | { id: string };

// Reads anything a scan or a person can give us:
//   https://app/?c=K7M2QX     -> { code }
//   https://app/?checkin=<id> -> { id }    (old posters keep working)
//   K7M2QX / k7m-2qx          -> { code }
// Returns null when it isn't a WashFlow check-in.
export function parseCheckIn(text: string): StationRef | null {
  const raw = (text || '').trim();
  if (!raw) return null;

  if (/^https?:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);
      const c = url.searchParams.get('c');
      if (c && isCheckInCode(cleanCode(c))) return { code: cleanCode(c) };
      const id = url.searchParams.get('checkin');
      if (id && isStationId(id)) return { id };
    } catch { /* not a URL */ }
    return null;
  }

  const code = cleanCode(raw);
  if (isCheckInCode(code)) return { code };
  if (isStationId(raw)) return { id: raw };
  return null;
}

// Turns what a person typed ("k7m 2qx", "K7M-2QX") into "K7M2QX".
export function cleanCode(input: string): string {
  return (input || '').toUpperCase().replace(/[\s\-_.]/g, '');
}

// Where the poster's QR code should point. On a laptop running the app locally
// window.location.origin is http://localhost:3000, which a phone cannot open,
// so a public address can be set with VITE_PUBLIC_APP_URL.
export function publicAppUrl(): string {
  const env = (import.meta as any).env?.VITE_PUBLIC_APP_URL as string | undefined;
  return (env && env.trim() ? env.trim() : window.location.origin).replace(/\/$/, '');
}

export function checkInLink(code: string): string {
  return `${publicAppUrl()}/?c=${code}`;
}

// True when the address only works on this computer (localhost or a private
// network IP). Phones scanning a QR code with such an address get nothing.
export function isLocalAddress(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0' || h.endsWith('.local') ||
      /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h);
  } catch {
    return true;
  }
}
