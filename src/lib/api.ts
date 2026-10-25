import { auth } from './firebase';

// Calls our own /api endpoints with the signed-in user's Firebase ID token, so
// the server knows who is asking. Throws an Error with a readable message on
// failure.
export async function apiFetch<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new Error('Please sign in first.');
  const token = await user.getIdToken();

  const res = await fetch(path, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`,
    },
  });

  const type = res.headers.get('content-type') || '';
  const data: any = type.includes('application/json') ? await res.json() : { error: (await res.text()).slice(0, 200) };
  if (!res.ok) throw new Error(data?.error || data?.message || `Request failed (${res.status})`);
  return data as T;
}

// The QR link itself is built in src/lib/checkin.ts (checkInLink).
export const PENDING_CHECKIN_KEY = 'washflow_pending_checkin';
