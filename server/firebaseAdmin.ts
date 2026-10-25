// Server-side Firebase access.
//
// The browser app talks to Firestore with the *client* SDK, which is limited by
// firestore.rules. The server needs to do trusted things the browser must never
// be allowed to do (record a payment, add wash credits, save a payout account),
// so it uses the *Admin* SDK, which bypasses the rules.
//
// It needs a service account key. Set FIREBASE_SERVICE_ACCOUNT to the full JSON
// of the key (Firebase Console > Project settings > Service accounts > Generate
// new private key). On Vercel, paste the JSON into an environment variable.

import { initializeApp, cert, getApps, App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Firestore } from 'firebase-admin/firestore';
import fs from 'fs';
import path from 'path';

// On your own server it is easier to upload the key file than to paste it into a
// setting: put it next to the app as firebase-service-account.json (or point
// FIREBASE_SERVICE_ACCOUNT_FILE at it). It is never served to visitors.
function readServiceAccount(): string {
  const fromEnv = (process.env.FIREBASE_SERVICE_ACCOUNT || '').trim();
  if (fromEnv) return fromEnv;
  const file = process.env.FIREBASE_SERVICE_ACCOUNT_FILE || path.join(process.cwd(), 'firebase-service-account.json');
  try { return fs.readFileSync(file, 'utf8').trim(); } catch { return ''; }
}

// Which project and database to use. If FIREBASE_PROJECT_ID / FIRESTORE_DATABASE_ID
// are not set, the project comes from the service account key itself, so the
// server always talks to the same project the key belongs to. (Before, it fell
// back to the original AI Studio project, and a key from any other project got
// "7 PERMISSION_DENIED" on every save.)
const ORIGINAL_PROJECT_ID = 'gen-lang-client-0240146258';
const ORIGINAL_DATABASE_ID = 'ai-studio-44574057-005a-4867-ba43-3e982ca96f82';
let PROJECT_ID = '';
let DATABASE_ID = '';

let adminApp: App | null = null;
let adminDb: Firestore | null = null;
let initError: string | null = null;

function init() {
  if (adminApp || initError) return;
  const raw = readServiceAccount();
  if (!raw) {
    initError = 'FIREBASE_SERVICE_ACCOUNT is not set on the server, and no firebase-service-account.json file was found.';
    return;
  }
  try {
    const serviceAccount = JSON.parse(raw);
    PROJECT_ID = process.env.FIREBASE_PROJECT_ID || serviceAccount.project_id || ORIGINAL_PROJECT_ID;
    // The original AI Studio project uses a *named* database; new projects use "(default)".
    DATABASE_ID = process.env.FIRESTORE_DATABASE_ID || (PROJECT_ID === ORIGINAL_PROJECT_ID ? ORIGINAL_DATABASE_ID : '(default)');
    adminApp = getApps()[0] || initializeApp({ credential: cert(serviceAccount), projectId: PROJECT_ID });
    adminDb = getFirestore(adminApp, DATABASE_ID);
  } catch (e: any) {
    initError = `FIREBASE_SERVICE_ACCOUNT could not be parsed: ${e.message}`;
  }
}

export function adminReady(): { ok: boolean; error: string | null; projectId: string; databaseId: string } {
  init();
  return { ok: !!adminDb, error: initError, projectId: PROJECT_ID, databaseId: DATABASE_ID };
}

export function db(): Firestore {
  init();
  if (!adminDb) throw new Error(initError || 'Firebase Admin not initialised');
  return adminDb;
}

export async function verifyIdToken(token: string) {
  init();
  if (!adminApp) throw new Error(initError || 'Firebase Admin not initialised');
  return getAuth(adminApp).verifyIdToken(token);
}
