// Local development / self-hosted entry point.
// All API routes live in server/app.ts (shared with Vercel's api/index.ts).
import 'dotenv/config';
import path from 'path';
import fs from 'fs';
import express from 'express';
import { app } from './server/app.js';

const PORT = Number(process.env.PORT) || 3000;
const isProd = process.env.NODE_ENV === 'production';

async function start() {
  if (!isProd) {
    // In development, Vite serves the React app with hot reload.
    const { createServer } = await import('vite');
    const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      const indexPath = path.join(distPath, 'index.html');
      if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
      next();
    });
  }
  app.listen(PORT, '0.0.0.0', () => console.log(`[SERVER] http://localhost:${PORT}`));
}

start();
