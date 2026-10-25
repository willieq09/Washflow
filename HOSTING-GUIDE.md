# Putting AutoLux on your own hosting (cPanel), without Vercel

The app has two parts:
- the **website** people see (it lives in a folder called `dist`), and
- a small **server** that talks to Paystack and Firebase (one file called `server.cjs`).

Your hosting must be able to run **Node.js**. In cPanel, look for **Setup Node.js App** (under *Software*). If it is not there, the hosting is PHP-only and cannot run this app: ask the hosting company to enable Node.js, or use a VPS.

---

## Part A. Prepare the files on your laptop

1. **Put your Firebase details in the project.** Open `firebase-applet-config.json` in Notepad and make sure it has *your* Firebase project's values (the same ones you put on GitHub), with `"firestoreDatabaseId": "(default)"`.
2. **Install Node.js** from nodejs.org (the LTS version) if you haven't already.
3. Open the project folder, click the address bar, type `cmd`, press Enter. Then run these one at a time and wait for each to finish:
   ```
   npm install
   npm run build
   npm run build:server
   ```
   You now have a `dist` folder and a `server.cjs` file.
4. **Make the upload zip.** Select only these four and zip them together (right click > Send to > Compressed (zipped) folder):
   - `dist` (folder)
   - `server.cjs`
   - `package.json`
   - `package-lock.json`
5. **Get the Firebase server key file** (Firebase Console > ⚙️ Project settings > Service accounts > Generate new private key). Rename the downloaded file to exactly:
   ```
   firebase-service-account.json
   ```

---

## Part B. Create the app in cPanel

1. Log in to cPanel and open **Setup Node.js App**. Click **Create Application**.
2. Fill in:
   | Field | What to put |
   |---|---|
   | Node.js version | the highest offered, 18 or newer (20 is ideal) |
   | Application mode | **Production** |
   | Application root | `autolux` (a new folder; it is created outside `public_html`, which keeps your files private) |
   | Application URL | the domain, for example `autolux.com` (or a subdomain like `app.autolux.com`) |
   | Application startup file | `server.cjs` |
3. Click **Create**.

> If the domain already shows another website (for example the AutoLux landing page), using it here will replace that site. To keep both, create a subdomain first (cPanel > Domains > Create a new domain > `app.autolux.com`) and use that.

---

## Part C. Upload the files

1. Open **File Manager** and go into the `autolux` folder (the Application root, next to `public_html`, not inside it).
2. Click **Upload**, upload your zip, then right click it > **Extract**. You should now see `dist`, `server.cjs`, `package.json` and `package-lock.json` directly inside `autolux`.
3. Upload `firebase-service-account.json` into the same `autolux` folder.

---

## Part D. Add the keys and start it

1. Back in **Setup Node.js App**, click the pencil (edit) icon on your app.
2. Under **Environment variables**, click **Add Variable** for each of these:
   | Name | Value |
   |---|---|
   | `NODE_ENV` | `production` |
   | `PAYSTACK_SECRET_KEY` | your Paystack secret key (`sk_test_...` while testing, `sk_live_...` to launch) |
   | `FIREBASE_PROJECT_ID` | your Firebase project id |
   | `FIRESTORE_DATABASE_ID` | `(default)` |
   | `APP_URL` | `https://` + your domain, for example `https://autolux.com` |
   Optional: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` for emails.
3. Click **Save**.
4. Click **Run NPM Install** and wait until it finishes (a few minutes).
5. Click **Restart**.

---

## Part E. Switch on https and connect everything

1. **https:** cPanel > **SSL/TLS Status** > tick your domain > **Run AutoSSL**. The camera scanner and Google login need `https`.
2. **Check it's alive:** open `https://YOUR-DOMAIN/api/health`. You want `"paystack":true` and `"firebaseAdmin":true`.
3. **Firebase:** Authentication > Settings > Authorized domains > **Add domain** > your domain.
4. **Paystack:** Settings > API Keys & Webhooks > Webhook URL: `https://YOUR-DOMAIN/api/paystack/webhook` (set it in **Live** mode too when you switch to live keys).
5. Open `https://YOUR-DOMAIN`. Old station posters printed on the Vercel address won't open the new site, so **print new QR posters** from Settings.

---

## Updating the app later

Repeat Part A (only `npm run build` and `npm run build:server` are needed if nothing else changed), upload and extract the new zip over the old files in `autolux`, then click **Restart** in Setup Node.js App.

## If something is wrong

| What you see | What to do |
|---|---|
| "Incomplete response" or 503 | Setup Node.js App > open the app > check the **log file** shown there, send it to whoever helps you |
| `firebaseAdmin: false` | `firebase-service-account.json` is missing from the `autolux` folder or misnamed |
| `paystack: false` | `PAYSTACK_SECRET_KEY` missing, or you didn't Restart after adding it |
| The site shows a cPanel "Index of" page or old site | Application URL is set to a different domain, or the domain's `public_html` has an `index.html`/`index.php` taking over; ask the host to point the domain to the Node app |
| Login says "unauthorized domain" | add the domain in Firebase Authorized domains |
