// The one and only API for WashFlow.
//
// Used in two places:
//   * server.ts      -> local development (`npm run dev`)
//   * api/index.ts   -> Vercel serverless function in production
// Previously each of those had its own full copy of this code, so a fix in one
// silently didn't exist in the other. Now both import this file.
//
// HOW MONEY FLOWS (the "payment routing"):
//   1. A station owner adds their bank account in Settings. The server turns it
//      into a Paystack *subaccount* and stores the subaccount code.
//   2. When a customer buys from that station, the server starts the Paystack
//      checkout WITH the station's subaccount code. Paystack then splits the
//      money automatically: the platform keeps PLATFORM_FEE_PERCENT and the
//      rest settles directly into the owner's bank. No manual withdrawals.
//   3. The server (never the browser) records the payment, via the Paystack
//      webhook and/or the verify endpoint. Both are idempotent: a payment can
//      only ever be recorded once.

import express from 'express';
import cors from 'cors';
import axios from 'axios';
import crypto from 'crypto';
import nodemailer from 'nodemailer';
import { FieldValue } from 'firebase-admin/firestore';
import { adminReady, db, verifyIdToken } from './firebaseAdmin.js';

export const PLATFORM_FEE_PERCENT = 7.5;

// Prices live on the server so a customer cannot edit them in the browser.
// Amounts are in kobo (₦1 = 100 kobo), which is what Paystack expects.
export const PLAN_PRICES_KOBO: Record<string, number> = {
  starter: 1_900_000,
  standard: 4_900_000,
  elite: 9_900_000,
  basic_wash: 250_000,
  premium_wash: 1_000_000,
  unlimited_wash: 4_800_000,
};
export const PLAN_CREDITS: Record<string, number> = {
  basic_wash: 2,
  premium_wash: 5,
  unlimited_wash: 16,
};

const PAYSTACK = 'https://api.paystack.co';

function paystackSecret() {
  return (process.env.PAYSTACK_SECRET_KEY || process.env.PAYSTACK_SECRET || '').trim();
}
function ps() {
  return { headers: { Authorization: `Bearer ${paystackSecret()}`, 'Content-Type': 'application/json' }, timeout: 15000 };
}

export const app = express();
app.use(cors());
// Keep the raw body so the webhook signature can be checked.
app.use(express.json({ verify: (req: any, _res, buf) => { req.rawBody = buf; } }));

// ---------- helpers ----------

type AuthedRequest = express.Request & { uid?: string; email?: string };

// Every money-related endpoint requires a logged-in Firebase user. The browser
// sends its Firebase ID token; we check it here so nobody can call the API
// pretending to be someone else.
async function requireUser(req: AuthedRequest, res: express.Response, next: express.NextFunction) {
  const ready = adminReady();
  if (!ready.ok) return res.status(503).json({ error: `Payments are not configured on the server: ${ready.error}` });
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'You must be signed in.' });
  try {
    const decoded = await verifyIdToken(token);
    req.uid = decoded.uid;
    req.email = decoded.email;
    next();
  } catch {
    res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
  }
}

function requirePaystack(res: express.Response) {
  if (!paystackSecret()) {
    res.status(500).json({ error: 'PAYSTACK_SECRET_KEY is not set on the server.' });
    return false;
  }
  return true;
}

function getOrigin(req: express.Request) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '');
  const forwardedHost = req.headers['x-forwarded-host'];
  const forwardedProto = req.headers['x-forwarded-proto'] || 'https';
  if (forwardedHost) return `${forwardedProto}://${forwardedHost}`.replace(/\/$/, '');
  if (req.headers.origin) return req.headers.origin.toString().replace(/\/$/, '');
  return req.headers.host ? `https://${req.headers.host}` : 'http://localhost:3000';
}

function errMsg(error: any) {
  return error?.response?.data?.message || error?.message || 'Unexpected error';
}

// Records a successful payment exactly once. Safe to call many times for the
// same reference (webhook + redirect + admin repair can all call it).
export async function fulfilPayment(reference: string) {
  const verify = await axios.get(`${PAYSTACK}/transaction/verify/${encodeURIComponent(reference)}`, ps());
  const tx = verify.data?.data;
  if (!verify.data?.status || !tx) throw new Error('Paystack could not find this transaction.');
  if (tx.status !== 'success') return { fulfilled: false, paystackStatus: tx.status, tx };

  const firestore = db();
  const intentRef = firestore.collection('payments').doc(reference);

  const result = await firestore.runTransaction(async (t) => {
    const intentSnap = await t.get(intentRef);
    if (!intentSnap.exists) {
      // A payment we never started (e.g. an old transaction from before this
      // fix). Do not guess; an admin can review it.
      return { fulfilled: false, reason: 'unknown_reference' };
    }
    const intent = intentSnap.data()!;
    if (intent.status === 'fulfilled') return { fulfilled: true, alreadyDone: true, intent };

    if (tx.currency !== 'NGN' || Number(tx.amount) !== Number(intent.amountKobo)) {
      t.update(intentRef, { status: 'amount_mismatch', paidKobo: tx.amount, checkedAt: FieldValue.serverTimestamp() });
      return { fulfilled: false, reason: 'amount_mismatch' };
    }

    const amountNaira = intent.amountKobo / 100;

    // Read the customer's name/email for the notifications (reads must come
    // before writes inside a transaction).
    const customerSnap = await t.get(firestore.collection('users').doc(intent.userId));
    const customer: any = customerSnap.exists ? customerSnap.data() : {};

    if (intent.type === 'subscription') {
      const credits = PLAN_CREDITS[intent.plan] || 0;
      const userRef = firestore.collection('users').doc(intent.userId);
      const userUpdate: any = { plan: intent.plan };
      if (credits > 0) userUpdate.credits = FieldValue.increment(credits);
      t.set(userRef, userUpdate, { merge: true });
      t.set(firestore.collection('subscriptions').doc(`sub_${reference}`), {
        userId: intent.userId,
        planId: intent.plan,
        providerRef: reference,
        state: 'active',
        amount: amountNaira,
        creditsAwarded: credits,
        timestamp: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
      });
    } else if (intent.type === 'marketplace_item') {
      const platformFee = Math.round(amountNaira * PLATFORM_FEE_PERCENT) / 100;
      t.set(firestore.collection('orders').doc(`order_${reference}`), {
        userId: intent.userId,
        itemId: intent.itemId,
        itemName: intent.itemName,
        amount: amountNaira,
        platformFee,
        ownerShare: amountNaira - platformFee,
        // routed = Paystack already paid the owner's share into their bank.
        routed: !!intent.subaccount,
        subaccount: intent.subaccount || null,
        status: 'completed',
        paymentRef: reference,
        businessId: intent.businessId || '',
        ownerId: intent.ownerUid || '',
        timestamp: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
      });
    }

    // Payment notifications for the customer's and the admin's notification
    // centres. Written here (not in the browser) so they appear even if the
    // customer closes the page before returning to the app.
    const planId = intent.type === 'subscription' ? intent.plan : '';
    const itemName = intent.type === 'marketplace_item' ? (intent.itemName || 'Marketplace Item') : '';
    const credits = intent.type === 'subscription' ? (PLAN_CREDITS[intent.plan] || 0) : 0;
    const what = planId ? planId.replace(/_/g, ' ').toUpperCase() + ' PLAN' : (itemName || 'PURCHASE');
    const naira = `₦${amountNaira.toLocaleString()}`;
    const common = {
      userId: intent.userId,
      type: 'payment_confirmation',
      amount: amountNaira,
      reference,
      planId,
      itemName,
      customerEmail: customer.email || tx.customer?.email || '',
      customerName: customer.name || '',
      read: false,
      createdAt: FieldValue.serverTimestamp(),
    };
    t.set(firestore.collection('notifications').doc(`notif_cust_${reference}`), {
      ...common,
      recipient: 'user',
      title: `Payment Confirmed: ${naira}`,
      message: `Your payment of ${naira} for ${what} was verified and confirmed. ${credits ? `${credits} wash credits added to your dashboard. ` : ''}Ref: ${reference}`,
    });
    t.set(firestore.collection('notifications').doc(`notif_adm_${reference}`), {
      ...common,
      recipient: 'admin',
      title: `New Payment: ${naira}`,
      message: `${customer.name || 'Customer'} (${common.customerEmail || 'No Email'}) paid ${naira} for ${what}. Ref: ${reference}`,
    });

    t.update(intentRef, { status: 'fulfilled', fulfilledAt: FieldValue.serverTimestamp(), paystackId: tx.id });
    return { fulfilled: true, intent };
  });

  return { ...result, tx };
}

// ---------- basic ----------

app.get('/api/health', (_req, res) => {
  const ready = adminReady();
  res.json({ status: 'ok', paystack: !!paystackSecret(), firebaseAdmin: ready.ok, firebaseAdminError: ready.error, firebaseProject: ready.projectId || null, firestoreDatabase: ready.databaseId || null });
});

app.get('/api/config', (_req, res) => {
  res.json({ tomtom_api_key: (process.env.TOMTOM_API_KEY || process.env.VITE_TOMTOM_API_KEY || '').trim() });
});

let transporter: nodemailer.Transporter | null = null;
function getTransporter() {
  if (!transporter) {
    const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
    if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) return null;
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: parseInt(SMTP_PORT),
      secure: parseInt(SMTP_PORT) === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
  }
  return transporter;
}

// Only signed-in users may send emails through the app. Before this, anyone on
// the internet could use the platform's mail account to send
// any email to anyone (spam or phishing in WashFlow's name).
app.post('/api/notify', requireUser, async (req, res) => {
  try {
    const { to, subject, html } = req.body || {};
    if (typeof to !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to) || typeof subject !== 'string' || typeof html !== 'string') {
      return res.status(400).json({ error: 'Invalid email request.' });
    }
    const mail = getTransporter();
    if (!mail) return res.status(503).json({ error: 'Email service not configured' });
    const info = await mail.sendMail({ from: process.env.SMTP_FROM || `"NearWash" <${process.env.SMTP_USER}>`, to, subject, html });
    res.json({ success: true, messageId: info.messageId });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ---------- banks / payout accounts ----------

app.get('/api/paystack/banks', async (_req, res) => {
  if (!requirePaystack(res)) return;
  try {
    const r = await axios.get(`${PAYSTACK}/bank?country=nigeria&per_page=100`, ps());
    res.json(r.data.data);
  } catch (error: any) {
    res.status(500).json({ error: errMsg(error) });
  }
});

app.get('/api/paystack/resolve-account', requireUser, async (req, res) => {
  if (!requirePaystack(res)) return;
  try {
    const { account_number, bank_code } = req.query as Record<string, string>;
    if (!/^\d{10}$/.test(account_number || '') || !bank_code) return res.status(400).json({ error: 'Enter a 10 digit account number and choose a bank.' });
    const r = await axios.get(`${PAYSTACK}/bank/resolve?account_number=${account_number}&bank_code=${encodeURIComponent(bank_code)}`, ps());
    res.json(r.data.data);
  } catch (error: any) {
    res.status(400).json({ error: errMsg(error) });
  }
});

// Owner saves their payout bank account. Creates (or updates) their Paystack
// subaccount so future payments split automatically.
app.post('/api/paystack/subaccount', requireUser, async (req: AuthedRequest, res) => {
  if (!requirePaystack(res)) return;
  try {
    const { bank_code, bank_name, account_number } = req.body || {};
    if (!/^\d{10}$/.test(account_number || '') || !bank_code) return res.status(400).json({ error: 'Enter a 10 digit account number and choose a bank.' });

    const firestore = db();
    const userRef = firestore.collection('users').doc(req.uid!);
    const userSnap = await userRef.get();
    const user = userSnap.data();
    if (!user || user.role !== 'owner') return res.status(403).json({ error: 'Only station owners can set a payout account.' });

    const resolved = await axios.get(`${PAYSTACK}/bank/resolve?account_number=${account_number}&bank_code=${encodeURIComponent(bank_code)}`, ps());
    const accountName = resolved.data?.data?.account_name;
    if (!accountName) return res.status(400).json({ error: 'Paystack could not confirm that account.' });

    const body = {
      business_name: user.businessName || user.name || 'WashFlow Station',
      settlement_bank: bank_code,
      account_number,
      percentage_charge: PLATFORM_FEE_PERCENT, // the platform's share of each payment
      primary_contact_email: user.email || undefined,
    };

    const existingCode: string | undefined = user.payout?.subaccountCode;
    const r = existingCode
      ? await axios.put(`${PAYSTACK}/subaccount/${existingCode}`, body, ps())
      : await axios.post(`${PAYSTACK}/subaccount`, body, ps());
    const subaccountCode = r.data?.data?.subaccount_code || existingCode;
    if (!subaccountCode) return res.status(400).json({ error: r.data?.message || 'Paystack did not return a subaccount.' });

    const payout = {
      subaccountCode,
      bankCode: bank_code,
      bankName: bank_name || '',
      accountName,
      accountLast4: account_number.slice(-4),
      updatedAt: FieldValue.serverTimestamp(),
    };
    const batch = firestore.batch();
    batch.set(userRef, { payout }, { merge: true });
    const biz = await firestore.collection('wash_businesses').where('ownerUid', '==', req.uid).get();
    biz.forEach((d) => batch.set(d.ref, { subaccountCode }, { merge: true }));
    await batch.commit();

    res.json({ subaccountCode, accountName, bankName: bank_name || '', accountLast4: payout.accountLast4 });
  } catch (error: any) {
    res.status(error.response?.status || 500).json({ error: errMsg(error) });
  }
});

// ---------- starting payments ----------

app.post('/api/paystack/initialize', requireUser, async (req: AuthedRequest, res) => {
  if (!requirePaystack(res)) return;
  try {
    const { plan } = req.body || {};
    const amountKobo = PLAN_PRICES_KOBO[plan];
    if (!amountKobo) return res.status(400).json({ error: `Unknown plan: ${plan}` });

    const userSnap = await db().collection('users').doc(req.uid!).get();
    const email = userSnap.data()?.email || req.email;
    if (!email) return res.status(400).json({ error: 'Add an email address to your profile before paying.' });

    const reference = `SUB-${plan}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    await db().collection('payments').doc(reference).set({
      type: 'subscription', userId: req.uid, plan, amountKobo, status: 'initialized', createdAt: FieldValue.serverTimestamp(),
    });

    const r = await axios.post(`${PAYSTACK}/transaction/initialize`, {
      email, amount: amountKobo, currency: 'NGN', reference,
      callback_url: `${getOrigin(req)}/?paystack_success=true&ref=${reference}`,
      metadata: { userId: req.uid, plan, type: 'subscription' },
    }, ps());
    if (!r.data?.status) return res.status(400).json({ error: r.data?.message || 'Paystack refused the payment.' });
    res.json(r.data.data);
  } catch (error: any) {
    res.status(error.response?.status || 500).json({ error: errMsg(error) });
  }
});

app.post('/api/paystack/initialize-order', requireUser, async (req: AuthedRequest, res) => {
  if (!requirePaystack(res)) return;
  try {
    const { itemId } = req.body || {};
    if (!itemId) return res.status(400).json({ error: 'Missing item.' });

    const firestore = db();
    const itemSnap = await firestore.collection('marketplace_items').doc(String(itemId)).get();
    if (!itemSnap.exists) return res.status(404).json({ error: 'This item no longer exists.' });
    const item = itemSnap.data()!;
    const price = Number(item.price);
    if (!(price > 0)) return res.status(400).json({ error: 'This item has no valid price.' });

    // Find where the owner's share should go.
    let subaccount: string | null = null;
    if (item.ownerUid) {
      const ownerSnap = await firestore.collection('users').doc(item.ownerUid).get();
      subaccount = ownerSnap.data()?.payout?.subaccountCode || null;
    }
    if (!subaccount && process.env.REQUIRE_SELLER_PAYOUT === 'true') {
      return res.status(400).json({ error: 'This seller has not finished setting up payouts yet.' });
    }

    const userSnap = await firestore.collection('users').doc(req.uid!).get();
    const email = userSnap.data()?.email || req.email;
    if (!email) return res.status(400).json({ error: 'Add an email address to your profile before paying.' });

    const amountKobo = Math.round(price * 100);
    const reference = `ORD-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    await firestore.collection('payments').doc(reference).set({
      type: 'marketplace_item', userId: req.uid, itemId: itemSnap.id, itemName: item.name || 'Marketplace Item',
      businessId: item.businessId || '', ownerUid: item.ownerUid || '', subaccount, amountKobo,
      status: 'initialized', createdAt: FieldValue.serverTimestamp(),
    });

    const payload: any = {
      email, amount: amountKobo, currency: 'NGN', reference,
      callback_url: `${getOrigin(req)}/?paystack_success=true&ref=${reference}`,
      metadata: { userId: req.uid, itemId: itemSnap.id, itemName: item.name, businessId: item.businessId, ownerUid: item.ownerUid, type: 'marketplace_item' },
    };
    if (subaccount) {
      payload.subaccount = subaccount;
      // Who pays Paystack's processing fee: 'subaccount' (the owner) or
      // 'account' (the platform). This is a business decision.
      payload.bearer = process.env.PAYSTACK_FEE_BEARER === 'account' ? 'account' : 'subaccount';
    }

    const r = await axios.post(`${PAYSTACK}/transaction/initialize`, payload, ps());
    if (!r.data?.status) return res.status(400).json({ error: r.data?.message || 'Paystack refused the payment.' });
    res.json(r.data.data);
  } catch (error: any) {
    res.status(error.response?.status || 500).json({ error: errMsg(error) });
  }
});

// ---------- confirming payments ----------

// Called by the browser after Paystack redirects back. Also records the
// payment if the webhook has not done so yet.
app.get('/api/paystack/verify/:reference', requireUser, async (req: AuthedRequest, res) => {
  if (!requirePaystack(res)) return;
  try {
    const result: any = await fulfilPayment(req.params.reference);
    const tx = result.tx;
    res.json({
      status: tx.status,
      reference: tx.reference,
      amount: tx.amount,
      currency: tx.currency,
      metadata: tx.metadata,
      paid_at: tx.paid_at,
      customer: { email: tx.customer?.email },
      washflowFulfilled: !!result.fulfilled,
      washflowReason: result.reason || null,
      type: result.intent?.type || tx.metadata?.type || null,
      plan: result.intent?.plan || null,
      itemName: result.intent?.itemName || null,
      creditsAwarded: result.intent ? PLAN_CREDITS[result.intent.plan] || 0 : 0,
    });
  } catch (error: any) {
    res.status(error.response?.status || 500).json({ error: errMsg(error) });
  }
});

// Paystack calls this directly, even if the customer closes their browser
// before the redirect. Set the URL in Paystack Dashboard > Settings > API Keys
// & Webhooks:  https://YOUR-DOMAIN/api/paystack/webhook
app.post('/api/paystack/webhook', async (req: any, res) => {
  const signature = req.headers['x-paystack-signature'];
  const expected = crypto.createHmac('sha512', paystackSecret()).update(req.rawBody || '').digest('hex');
  if (!paystackSecret() || signature !== expected) return res.status(401).send('bad signature');

  // Do the work BEFORE replying: on Vercel the function can be frozen as soon
  // as it responds. If this fails we return 500 and Paystack retries later.
  try {
    if (req.body?.event === 'charge.success' && req.body?.data?.reference) {
      await fulfilPayment(req.body.data.reference);
    }
    res.sendStatus(200);
  } catch (e) {
    console.error('[WEBHOOK] fulfilment failed', e);
    res.sendStatus(500);
  }
});

app.use((err: any, _req: any, res: any, _next: any) => {
  console.error('[SERVER ERROR]', err);
  if (!res.headersSent) res.status(500).json({ error: err.message || 'Internal Server Error' });
});

export default app;
