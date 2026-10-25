// Vercel serverless entry point. vercel.json sends every /api/* request here.
// The actual routes live in server/app.ts (shared with local `npm run dev`).
// The ".js" ending is required: on Vercel this file runs as a plain Node.js
// module, and Node will not find '../server/app' without it (the function
// crashes with 500 FUNCTION_INVOCATION_FAILED). TypeScript maps .js to app.ts.
import { app } from '../server/app.js';

export default app;
