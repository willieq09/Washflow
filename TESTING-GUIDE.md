# How to test WashFlow, step by step

You don't need to know React or Node.js to do this. Think of it like checking a new bicycle: you don't need to know how it was built, you just ride it and see if everything works.

You will need: a laptop, two phones (or one phone and the laptop), and a Paystack account in **test mode**, which uses pretend money.

---

## Part 1. Wake the app up on your laptop

1. **Install Node.js.** Go to nodejs.org, download the "LTS" version and install it like any other program. Node is the engine that runs the app.
2. **Open a terminal in the project folder.** On Windows, open the `Washflow-main` folder, click the address bar at the top, type `cmd` and press Enter. A black window opens. That's the terminal.
3. **Download the app's parts.** Type this and press Enter, then wait until it stops:
   ```
   npm install
   ```
4. **Give the app its keys.** Copy the file `.env.example` and rename the copy to `.env`. Open it in Notepad and fill in:
   - `PAYSTACK_SECRET_KEY` and `VITE_PAYSTACK_PUBLIC_KEY`: from Paystack Dashboard > Settings > API Keys. Use the ones that start with `sk_test_` and `pk_test_`.
   - `FIREBASE_SERVICE_ACCOUNT`: from Firebase Console > Project settings > Service accounts > Generate new private key. A file downloads. Open it, copy everything, and paste it after the `=` **on one single line**.
5. **Start the app:**
   ```
   npm run dev
   ```
   When you see `http://localhost:3000`, it's awake. Leave this window open.
6. **Check its heartbeat.** In your browser open `http://localhost:3000/api/health`. You want to see `"paystack": true` and `"firebaseAdmin": true`. If either says `false`, a key in `.env` is missing or pasted wrongly.
7. **Check the tests.** Open a second terminal in the same folder and type `npm test`. You want to see **10 passed**.

---

## Part 2. Put it online so phones can reach it

**Why:** `localhost` means "this computer". A phone that scans a QR code pointing at localhost looks inside *itself* and finds nothing. Also, phone browsers only let a website use the camera when the address starts with `https`.

The project is already set up for **Vercel**:

1. Push the code to GitHub (or drag the folder into Vercel), then open the project on vercel.com.
2. Go to **Settings > Environment Variables** and add everything from your `.env` file.
3. Click **Redeploy**. Vercel gives you an address like `https://washflow-xxxx.vercel.app`.
4. Open `https://YOUR-ADDRESS/api/health` and check for the two `true`s again.

From now on, do all phone tests on that `https://` address.

> If you only want to test on your laptop, you can instead put `VITE_PUBLIC_APP_URL=https://YOUR-ADDRESS` in `.env` so the QR codes point at the live site.

---

## Part 3. Test the QR check-in

You play two people: the **owner** (laptop) and the **customer** (phone).

### A. The owner makes the poster
1. On the laptop, open the live address and sign in as a **station owner**.
2. Go to **Settings**, fill in the business details and press **Commit Settings**.
3. Scroll down to **Check-in QR Code**. You should see:
   - a QR code with a thick white border,
   - a 6-character code in big letters, for example `K7M2QX`,
   - **no** yellow warning. If you see a warning about localhost, you're not on the live address (go back to Part 2).
4. Press **Print Poster**. A page with the QR, the code and instructions opens. Print it, or just leave it on the screen.

✅ Pass if the code and QR appear and the poster looks sharp.

### B. The customer scans with the phone camera
1. On the phone, sign in once as a **customer** on the live address, then close the browser.
2. Open the normal **camera app** and point it at the poster (or the laptop screen) from about 30 cm away.
3. A link pops up. Tap it.
4. WashFlow opens with **Station Check-in** and the station name. Pick a car (or type one) and press **Check me in**.

✅ Pass if you see the green tick and "You're checked in".

### C. The customer whose camera can't scan
1. On the phone, open WashFlow and go to the customer **Hub**.
2. Tap the big **Check in at a station** button at the top.
3. Tap **Scan QR**. Allow the camera when the phone asks. Point it at the poster. It should find it by itself within a second or two.
4. Close it, open it again, tap **Enter code** and type the 6 letters from the poster.

✅ Pass if both ways open the same Station Check-in screen.

### D. The tricky cases
1. **Scan twice.** Scan the same poster again with the same car. It should say "You were already checked in", not add a second one.
2. **Not signed in.** Sign out on the phone, scan the poster, sign in. The check-in screen should appear right after signing in.
3. **Wrong code.** Type `AAAAAA` in Enter code. It should say the code doesn't match any station.
4. **Old phone.** If you have an old Android whose camera has no QR reader, use step C. That's exactly what it's for.

### E. The owner sees the car
1. On the laptop, open the owner **Dashboard**.
2. The customer's car should be in the queue with the tag **QR walk-in**, without refreshing the page.
3. Assign a worker. The car should **stay** in the queue (as Confirmed).
4. Signed in as that worker, at the station (the app checks GPS), press **Check-In** and log the wash.
5. If the customer had wash credits, they should have **exactly one less**, and the wash price shows ₦0.

✅ Pass if all of the above happen.

---

## Part 4. Test the payments (pretend money)

Paystack test mode accepts this pretend card:
- Card number: `4084 0840 8408 4081`
- Expiry: any future date, CVV: `408`
- PIN: `0000`, OTP: `123456`

### A. The owner adds their bank
1. As the owner, go to **Settings > Payout Account**, choose a bank, type a 10-digit account number and press verify.
2. The account holder's name should appear. Save it.

✅ Pass if it says the payout account is saved. (In test mode no real money moves.)

### B. A customer buys from the marketplace
1. As a customer, buy an item from that owner's marketplace with the pretend card.
2. You should come back to WashFlow with a success message.
3. In Paystack Dashboard > Transactions (test mode), open the payment. It should show the money **split**: 7.5% to the platform, the rest to the owner's subaccount.

### C. A customer buys a wash plan
1. Buy a wash plan with the pretend card.
2. Your credits go up by the plan's amount.
3. **Refresh the page.** The credits must **not** go up again.

### D. The browser closes too early
1. Start another purchase, pay, and **close the tab** as soon as Paystack says it worked.
2. Open the app again a minute later. The order or credits should still be there. That's the webhook doing its job. (For this, the webhook address `https://YOUR-ADDRESS/api/paystack/webhook` must be saved in Paystack > Settings > API Keys & Webhooks.)

✅ Pass if every purchase is recorded exactly once.

---

## Part 5. If something fails

Write down three things and send them to whoever is helping you:
1. Which step number failed.
2. What you expected, and what happened instead.
3. Any red text. On a laptop, press **F12**, click **Console** and take a screenshot.

Common ones:
| What you see | What it usually means |
|---|---|
| `firebaseAdmin: false` | `FIREBASE_SERVICE_ACCOUNT` is missing, or wasn't pasted on one line |
| The phone opens the link but nothing loads | The QR points at localhost. Use the live address |
| "Camera only works over https" | You opened the app on an `http://` address. Use the live `https://` one |
| Queue is empty and the Console mentions "create index" | Click the link in the error once. Firebase builds the index in a few minutes |
| A payment is in Paystack but not in the app | Check the webhook address in Paystack, or use the admin Transaction Repair panel |
