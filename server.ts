import "express-async-errors";
import express from "express";
import path from "path";
import axios from "axios";
import fs from "fs";
import { fileURLToPath } from 'url';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import cors from 'cors';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

// Paystack Configuration - Clean carefully
const PAYSTACK_SECRET = (process.env.PAYSTACK_SECRET_KEY || process.env.PAYSTACK_SECRET || "").trim();

console.log(`[SERVER] Startup. Paystack Secret configured: ${!!PAYSTACK_SECRET}`);
if (PAYSTACK_SECRET) {
  console.log(`[SERVER] Paystack Secret starts with: ${PAYSTACK_SECRET.substring(0, 7)}...`);
}

// Nodemailer Lazy Initialization
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

// API Routes
app.get("/api/health", (req, res) => {
  const secretStatus = !!PAYSTACK_SECRET;
  res.json({ 
    status: "ok", 
    timestamp: new Date().toISOString(),
    paystack_configured: secretStatus,
    secret_prefix: secretStatus ? PAYSTACK_SECRET.substring(0, 4) : null,
    node_env: process.env.NODE_ENV || 'development'
  });
});

app.get("/api/paystack/debug", (req, res) => {
  res.json({
    has_secret: !!PAYSTACK_SECRET,
    secret_length: PAYSTACK_SECRET.length,
    env_keys: Object.keys(process.env).filter(k => k.includes('PAYSTACK'))
  });
});

app.post("/api/notify", async (req, res) => {
  const { to, subject, html } = req.body;
  const mailTransporter = getTransporter();
  if (!mailTransporter) return res.status(503).json({ error: "Email service not configured" });

  const info = await mailTransporter.sendMail({
    from: process.env.SMTP_FROM || `"NearWash System" <${process.env.SMTP_USER}>`,
    to, subject, html,
  });
  res.json({ success: true, messageId: info.messageId });
});

// Helper for cleaned origins
function getOrigin(req: express.Request) {
  // Priority: X-Forwarded-Proto/Host (for proxies) > Origin > Referer
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  
  if (req.headers.origin) return req.headers.origin.toString().replace(/\/$/, "");
  
  if (req.headers.referer) {
    try {
      const url = new URL(req.headers.referer as string);
      return `${url.protocol}//${url.host}`;
    } catch (e) {
      // ignore invalid referer urls
    }
  }
  
  if (host) return `${proto}://${host}`;
  return `http://localhost:${PORT}`;
}

app.post("/api/paystack/initialize-order", async (req, res) => {
  const { email, amount, itemId, itemName, userId } = req.body;
  console.log(`[PAYSTACK] Init Order: User=${userId}, Item=${itemName}, Email=${email}`);
  
  if (!PAYSTACK_SECRET) return res.status(500).json({ error: "Paystack secret key is missing on server." });

  const origin = getOrigin(req);
  const cleanAmount = Math.round(Number(amount));
  if (isNaN(cleanAmount) || cleanAmount <= 0) return res.status(400).json({ error: "Invalid payment amount." });
    
  const response = await axios.post("https://api.paystack.co/transaction/initialize", {
    email, 
    amount: cleanAmount,
    callback_url: `${origin}/?paystack_success=true&order_type=item&item_id=${itemId}`,
    metadata: { userId, itemId, itemName, type: 'marketplace_item' }
  }, {
    headers: { Authorization: `Bearer ${PAYSTACK_SECRET}`, "Content-Type": "application/json" },
    timeout: 15000
  });
  
  res.json(response.data.data);
});

app.post("/api/paystack/initialize", async (req, res) => {
  const { email, amount, plan, userId } = req.body;
  console.log(`[PAYSTACK] Initializing subscription: User=${userId}, Plan=${plan}, Amount=${amount}, Email=${email}`);
  
  if (!PAYSTACK_SECRET || PAYSTACK_SECRET.length < 5) {
    console.error("[PAYSTACK] Config error: Secret is missing or too short");
    return res.status(500).json({ 
      error: "Paystack secret key is missing on the server. Please add PAYSTACK_SECRET_KEY to your environment variables." 
    });
  }

  if (!email || !amount || !plan) {
    return res.status(400).json({ error: "Missing required fields: email, amount, or plan" });
  }

  const origin = getOrigin(req);
  const cleanAmount = Math.round(Number(amount));
  
  if (isNaN(cleanAmount) || cleanAmount <= 0) {
    return res.status(400).json({ error: `Invalid amount: ${amount}` });
  }

  try {
    const paystackPayload = {
      email, 
      amount: cleanAmount,
      callback_url: `${origin}/?paystack_success=true&plan=${plan}`,
      metadata: { 
        userId, 
        plan, 
        type: 'subscription',
        source: 'AutoLux Web App'
      },
      channels: ['card', 'bank', 'ussd', 'qr', 'mobile_money', 'bank_transfer']
    };

    console.log(`[PAYSTACK] Sending request to Paystack API for ${email}...`);
    const response = await axios.post("https://api.paystack.co/transaction/initialize", paystackPayload, {
      headers: { 
        Authorization: `Bearer ${PAYSTACK_SECRET}`, 
        "Content-Type": "application/json",
        "Cache-Control": "no-cache"
      },
      timeout: 20000 // Increased timeout
    });

    if (response.data && response.data.status) {
      console.log(`[PAYSTACK] Success: ${response.data.data.reference}`);
      return res.json(response.data.data);
    } else {
      console.error("[PAYSTACK] API returned status false:", response.data);
      return res.status(400).json({ error: response.data?.message || "Paystack failed to initialize transaction" });
    }
  } catch (error: any) {
    const paystackError = error.response?.data;
    console.error("[PAYSTACK CRITICAL ERROR]", {
      status: error.response?.status,
      message: error.message,
      data: paystackError
    });

    return res.status(error.response?.status || 500).json({ 
      error: paystackError?.message || error.message || "An error occurred while connecting to Paystack.",
      code: "PAYSTACK_INIT_FAILED"
    });
  }
});

app.get("/api/paystack/banks", async (req, res) => {
  if (!PAYSTACK_SECRET) return res.status(500).json({ error: "Secret missing" });
  const response = await axios.get(`https://api.paystack.co/bank?country=nigeria&per_page=100`, {
    headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` },
    timeout: 8000
  });
  res.json(response.data.data);
});

app.get("/api/paystack/resolve-account", async (req, res) => {
  const { account_number, bank_code } = req.query;
  if (!PAYSTACK_SECRET) return res.status(500).json({ error: "Secret missing" });
  const resPay = await axios.get(`https://api.paystack.co/bank/resolve?account_number=${account_number}&bank_code=${bank_code}`, {
    headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` },
    timeout: 10000
  });
  res.json(resPay.data.data);
});

app.post("/api/paystack/transfer", async (req, res) => {
  const { amount, account_number, bank_code, account_name, userId } = req.body;
  if (!PAYSTACK_SECRET) return res.status(500).json({ error: "Secret missing" });
  
  const recipientRes = await axios.post("https://api.paystack.co/transferrecipient", {
    type: "nuban", name: account_name, account_number, bank_code, currency: "NGN"
  }, {
    headers: { Authorization: `Bearer ${PAYSTACK_SECRET}`, "Content-Type": "application/json" },
    timeout: 10000
  });
  
  const transferRes = await axios.post("https://api.paystack.co/transfer", {
    source: "balance", 
    amount: Math.round(Number(amount)), 
    recipient: recipientRes.data.data.recipient_code, 
    reason: `Withdrawal ${userId}`
  }, {
    headers: { Authorization: `Bearer ${PAYSTACK_SECRET}`, "Content-Type": "application/json" },
    timeout: 10000
  });
  
  res.json(transferRes.data);
});

// Deployment logic
const distPath = path.join(process.cwd(), 'dist');
const isProd = process.env.NODE_ENV === "production" || process.env.VERCEL === '1' || fs.existsSync(distPath);

if (isProd) {
  app.use(express.static(distPath));
} else {
  // Dynamic import for vite
  const setupVite = async () => {
    try {
      const { createServer } = await import("vite");
      const v = await createServer({ server: { middlewareMode: true }, appType: "spa" });
      app.use(v.middlewares);
      console.log("[SERVER] Vite middleware initialized");
    } catch (e) {
      console.error("[SERVER] Failed to load Vite:", e);
    }
  };
  setupVite();
}

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  if (isProd && fs.existsSync(path.join(distPath, 'index.html'))) {
    res.sendFile(path.join(distPath, 'index.html'));
  } else {
    next();
  }
});

// Global Error Handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error("[SERVER] Unhandled Error:", err.response?.data || err.message || err);
  if (!res.headersSent) {
    res.status(err.response?.status || 500).json({ 
      error: err.response?.data?.message || err.message || "An internal server error occurred."
    });
  }
});

if (process.env.VERCEL !== '1') {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[SERVER] Running on http://localhost:${PORT} [${isProd?'PROD':'DEV'}]`);
  });
}

export default app;
