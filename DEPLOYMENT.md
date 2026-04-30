# Deployment Guide for WashFlow

WashFlow is ready to be hosted! Since we use **Firebase** for data and **Vite** for the frontend, you have several high-performance options.

## 1. Environment Variables (Required)
Regardless of where you host, you **MUST** set the following environment variable in your hosting provider's dashboard:

*   `GEMINI_API_KEY`: Your Google GenAI key for maintenance tips.

---

## 2. Option A: Vercel (Recommended)
Vercel is the easiest for React apps. We have already prepared a `vercel.json` for you.

1.  Connect your GitHub repository to [Vercel](https://vercel.com).
2.  Set the **Framework Preset** to **Vite**.
3.  Add the `GEMINI_API_KEY` in the **Environment Variables** section.
4.  Click **Deploy**.
5.  **CRITICAL**: Copy your Vercel URL (e.g., `washflow.vercel.app`) and add it to **Firebase Console** -> **Authentication** -> **Settings** -> **Authorized Domains**.

---

## 3. Option B: Firebase Hosting
Since you already have a Firebase project, this keeps everything in one place. We have prepared `firebase.json` and `.firebaserc`.

1.  Install the Firebase CLI: `npm install -g firebase-tools`
2.  Login: `firebase login`
3.  Build the app: `npm run build`
4.  Deploy: `firebase deploy`

---

## 4. Option C: Render
1.  Create a new **Static Site** on [Render](https://render.com).
2.  **Build Command**: `npm run build`
3.  **Publish Directory**: `dist`
4.  Add the `GEMINI_API_KEY` in the **Environment Variables**.

---

## 5. Automated CI/CD (GitHub Actions)
The repository is configured with an automated pipeline. If your builds are failing on GitHub, you likely need to add the following **Secrets** to your GitHub repository (**Settings > Secrets and variables > Actions**):

### Vercel Secrets
*   `VERCEL_TOKEN`: Your Vercel Personal Access Token.
*   `VERCEL_ORG_ID`: Found in your Vercel Account/Team settings.
*   `VERCEL_PROJECT_ID`: Found in your Vercel Project settings.

### Firebase Secrets
*   `FIREBASE_SERVICE_ACCOUNT_WASHFLOW_APP`: JSON key from Firebase Console > Project Settings > Service accounts.
*   `FIREBASE_PROJECT_ID`: Your Firebase project ID (e.g., `washflow-12345`).

### Application Build Secrets
*   `GEMINI_API_KEY`: Required for the AI functionality.
*   `VITE_PAYSTACK_PUBLIC_KEY`: Used during the build for Paystack integration.
*   `PAYSTACK_SECRET_KEY`: Required on the server for transaction processing.
