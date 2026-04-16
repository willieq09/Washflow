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

## Pre-configured Files
We've added the following files to your project to make this work:
- `vercel.json`: Handles Single Page Application (SPA) routing for Vercel.
- `firebase.json` & `.firebaserc`: Configuration for Firebase Hosting.
- `.env.example`: Reference for required secrets.
