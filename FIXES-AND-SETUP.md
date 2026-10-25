# WashFlow: QR check-in and payment routing fixes

This file explains what was changed, how to switch it on, and how to test it. Read it top to bottom once before deploying.

## 1. The project in plain terms

WashFlow is written in **TypeScript** (JavaScript with type labels). It has three parts:

| Part | What it is | Where it lives |
|---|---|---|
| Frontend | React app the users see | `src/App.tsx` (most screens), `src/components/` |
| Backend | Small Node.js/Express server that talks to Paystack | `server/app.ts` |
| Database and logins | Firebase Firestore and Firebase Auth | `firestore.rules` controls who can read/write what |

`server.ts` runs the backend locally. `api/index.ts` runs the same backend on Vercel. Both now import `server/app.ts`, so there is only one copy of the API to maintain.

## 2. Files changed or added

| File | Status | Purpose |
|---|---|---|
| `server/app.ts` | new | All API routes, Paystack subaccounts, webhook, payment recording |
| `server/firebaseAdmin.ts` | new | Lets the server write to Firestore securely |
| `server.ts`, `api/index.ts` | rewritten | Now just thin wrappers around `server/app.ts` |
| `src/lib/api.ts` | new | Sends the logged-in user's identity with API calls |
| `src/components/CheckInQRCard.tsx` | new | Owner's printable QR code (Settings page) |
| `src/components/CheckInModal.tsx` | new | What a customer sees after scanning |
| `src/components/PayoutSetupCard.tsx` | new | Owner adds their bank account (Settings page) |
| `src/App.tsx` | small edits | Check-in and payment bug fixes (listed below) |
| `firestore.rules` | edited | Security fixes and rules the new features need |
| `package.json` | edited | Added `qrcode.react` and `firebase-admin` |
| `.env.example` | edited | New settings listed |

## 3. How QR check-in works now

1. Owner opens **Settings**, saves business details once, and the **Check-in QR Code** card appears. They download or print it and place it at the entrance.
2. A customer scans it with the normal phone camera. The app opens at `/?checkin=<stationId>`. If they are not logged in, the check-in is remembered until they log in.
3. They pick their car and tap **Check me in**. A booking is created instantly with the tag "QR walk-in".
4. Staff see it live in the Dashboard queue and press **Check-In** to log the wash. A wash credit is used automatically if the customer has one.

Bugs fixed along the way:
- Bookings disappeared from the queue once a worker was assigned (queue only showed "pending").
- Workers were blocked from pressing "Accept Job" by the database rules.
- Check-In failed because the form searched every customer in the database, which the rules forbid. It now uses the customer already attached to the booking.
- Workers could not deduct wash credits. Staff can now remove exactly one credit, nothing more.

## 4. How payment routing works now

1. Owner opens **Settings > Payout Account**, picks their bank, enters the account number, verifies the name and saves. The server creates a **Paystack subaccount** for them.
2. When a customer buys from that station, the server starts the Paystack checkout with that subaccount. Paystack splits the money itself: **7.5% to the platform, the rest settles directly to the owner's bank**.
3. The **server** records the payment (order, subscription, credits), never the browser. It does this both from the Paystack webhook and when the customer is redirected back, and a payment can only ever be recorded once.

Security problems fixed:
- Removed `/api/paystack/transfer`, which let anyone move money out of the Paystack balance with no login.
- Prices now come from the server, so a customer can no longer pay ₦1 for anything.
- Users can no longer give themselves credits or a plan from the browser.
- Nobody can make themselves an admin through the database. Only the two admin emails can.
- Workers can only join the station that invited them.
- Owners only see their own orders, not every station's.
- Withdrawal requests were always rejected (rule demanded "processed" while the app sent "pending"). Fixed, and admins can now mark them paid.
- Marketplace orders paid straight to an owner's bank are no longer counted again in their "withdrawable" balance.

## 5. Setup (do these in order)

### Step 1. Install and run locally
1. Install **Node.js 20 or newer** from nodejs.org.
2. In the project folder run `npm install`.
3. Copy `.env.example` to `.env` and fill it in (Steps 2 and 3).
4. Run `npm run dev` and open http://localhost:3000
5. Open http://localhost:3000/api/health. You want `"paystack": true` and `"firebaseAdmin": true`.

### Step 2. Paystack keys
Paystack Dashboard > Settings > API Keys & Webhooks. Use the **test** keys first.
- `PAYSTACK_SECRET_KEY` = `sk_test_...`
- `VITE_PAYSTACK_PUBLIC_KEY` = `pk_test_...`

### Step 3. Firebase service account
Firebase Console > Project settings > Service accounts > **Generate new private key**. A JSON file downloads. Put its **entire contents on one line** into `FIREBASE_SERVICE_ACCOUNT`. Treat this file like a password: never commit it or share it.

### Step 4. Deploy the database rules
```
npm install -g firebase-tools
firebase login
firebase deploy --only firestore:rules
```
**Do this together with deploying the new app code**, not before. The new rules intentionally block the old app's way of recording payments.

### Step 5. Vercel environment variables
Vercel > Project > Settings > Environment Variables. Add everything from your `.env`, including `FIREBASE_SERVICE_ACCOUNT`. Optionally set `APP_URL` to your live address. Redeploy.

### Step 6. Paystack webhook
Paystack Dashboard > Settings > API Keys & Webhooks > Webhook URL:
```
https://YOUR-DOMAIN/api/paystack/webhook
```
This records payments even if the customer closes their browser before returning to the app.

### Step 7. Firestore index (only if asked)
If the Dashboard queue shows nothing and the browser console shows a Firestore error with a link to "create index", click that link and create it. The queue now looks for both "pending" and "confirmed" bookings.

## 6. Test checklist (test mode)

Check-in:
- [ ] Owner: Settings shows a QR code after saving business details.
- [ ] Scan it on a phone logged in as a customer. Pick a car, check in, see the success screen.
- [ ] Scan again: it says you are already checked in (no duplicate).
- [ ] Owner Dashboard shows the car with the "QR walk-in" tag.
- [ ] Assign a worker: the booking stays in the queue as Confirmed.
- [ ] Worker presses Check-In and logs the wash while at the station (GPS geofence applies).
- [ ] A customer with credits loses exactly one credit and the wash shows price ₦0.

Payments:
- [ ] Owner adds a bank account in Payout Account and sees the confirmed account name. Test mode accepts Paystack's test bank details.
- [ ] Customer buys a marketplace item with a Paystack test card. The success message appears and an order exists in Firestore with `routed: true`.
- [ ] In Paystack Dashboard > Transactions, the payment shows the subaccount split.
- [ ] Customer buys a wash plan. Credits increase by the plan amount, once only (refresh the page and confirm they don't increase again).
- [ ] Close the tab on the Paystack page right after paying. The order or credits still appear within a minute (webhook).
- [ ] Owner submits a withdrawal request. It succeeds and appears in the admin settlement queue.

## 7. Known limits and open questions

These were **not** changed because they are business decisions. Confirm them with whoever owns the project:

1. **Wash payments are still cash.** The app records wash prices but customers don't pay for washes in-app, yet that cash is counted as money the owner can "withdraw" from the platform. Decide: add in-app payment at check-in (routed to the owner the same way), or change the dashboard so cash washes create a fee the owner owes the platform.
2. **Who pays Paystack's fee.** Currently the owner (`PAYSTACK_FEE_BEARER=subaccount`). Set it to `account` if the platform should pay.
3. **Phone login has no SMS code.** Anyone who types a registered phone number gets that account, including its credits. This needs Firebase Phone Authentication (OTP). Until then, it is the biggest remaining security risk.
4. Owner balance and stats only count the 50 most recent washes, so totals shrink as more washes are logged.
5. Old payments made **before** this update can't be matched automatically. Use the admin Transaction Repair panel for those.
6. The database rules were reviewed by hand but not run in the Firebase emulator. Test the checklist above in test mode before going live.

## 8. QR scanning fix (second round)

Customers reported that most phone cameras would not scan the station QR code. The causes and fixes:

| Problem | Fix |
|---|---|
| The QR held a long link (`?checkin=<20-character id>`), so it had many tiny squares | Each station now gets a 6-character **check-in code** (for example `K7M2QX`). The QR holds a short link, `/?c=K7M2QX`, so the squares are bigger |
| The downloaded and printed image had only 1 square of white border. Cameras need about 4 | The white border (quiet zone) is now 4 squares and is part of the image itself |
| The printed poster stretched a 200px picture, so its edges were blurry | The poster prints a sharp vector QR about 11 cm wide. The PNG download is 1200px |
| When the owner opened the app on a laptop at `http://localhost:3000`, the QR pointed at localhost, which no phone can open | The QR card shows a warning when that happens. Set `VITE_PUBLIC_APP_URL`, or open the app from its live address before printing |
| Many budget Android phones have a camera app with no QR reader at all | Customers get a **Check in at a station** button in the app with its own scanner (works on any phone with a browser), plus **Enter code** for typing the 6 characters printed on the poster |

Old posters (`?checkin=<id>`) still work, but print new ones so customers get the easier QR.

Files: `src/lib/checkin.ts` (codes and link reading, with tests), `src/components/CheckInQRCard.tsx` (rebuilt), `src/components/QRScanModal.tsx` (new), `src/components/CheckInModal.tsx` (finds a station by code), `src/App.tsx` (reads `?c=` and adds the customer button). New package: `jsqr`.

Also fixed in this round:
- `/api/notify` sent emails for anyone on the internet. It now requires a signed-in user.
- The currency tests expected dollars, so `npm test` (and the CI pipeline) always failed. They now test Naira.

See `TESTING-GUIDE.md` for a step-by-step test in plain language.

## 9. Merged with the notifications update

This version is built on the latest `main` (including "add notification schema and system support"). Everything from that update is kept: the notification centre, payment confirmation receipts, the admin payment stream and Simulate Payment. Two parts were adjusted so they work with the server-side payment routing:

- **Payment notifications are now written by the server** (in `fulfilPayment`, `server/app.ts`) at the same moment the payment is recorded. They appear even if the customer closes the page before returning, and nobody can create a fake "payment confirmed" notification from the browser.
- **Notification rules:** customers read and mark their own notifications; only admins (and the server) create them. Previously any signed-in user could read admin notifications, which include other customers' names and emails.

`firebase-applet-config.json` and `.firebaserc` are unchanged, so the live site keeps using the same Firebase project.
