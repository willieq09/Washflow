import express from "express";
import path from "path";
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

// API Request Logger
app.use("/api", (req, res, next) => {
  console.log(`[API] ${req.method} ${req.originalUrl}`);
  next();
});

// Paystack Configuration - Clean carefully
const PAYSTACK_SECRET = (process.env.PAYSTACK_SECRET_KEY || process.env.PAYSTACK_SECRET || "").trim();

console.log(`[SERVER] Startup. Paystack Secret configured: ${!!PAYSTACK_SECRET}`);

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

app.get("/api/paystack/test-connectivity", async (req, res) => {
  try {
    const response = await fetch("https://api.paystack.co/bank", {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` }
    });
    const data: any = await response.json();
    res.json({ 
      can_reach_paystack: true, 
      status: response.status, 
      paystack_status: data.status,
      message: data.message
    });
  } catch (error: any) {
    res.status(500).json({ can_reach_paystack: false, error: error.message });
  }
});

app.get("/api/paystack/debug", (req, res) => {
  res.json({
    has_secret: !!PAYSTACK_SECRET,
    secret_length: PAYSTACK_SECRET.length,
    env_keys: Object.keys(process.env).filter(k => k.includes('PAYSTACK'))
  });
});

app.post("/api/notify", async (req, res) => {
  try {
    const { to, subject, html } = req.body;
    const mailTransporter = getTransporter();
    if (!mailTransporter) return res.status(503).json({ error: "Email service not configured" });

    const info = await mailTransporter.sendMail({
      from: process.env.SMTP_FROM || `"NearWash System" <${process.env.SMTP_USER}>`,
      to, subject, html,
    });
    res.json({ success: true, messageId: info.messageId });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Helper for cleaned origins
function getOrigin(req: express.Request) {
  // Try to use X-Forwarded headers (for proxies/Cloud Run)
  const forwardedHost = req.headers['x-forwarded-host'];
  const forwardedProto = req.headers['x-forwarded-proto'] || 'https';
  
  if (forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`.replace(/\/$/, "");
  }

  // Fallback to Origin or Referer
  if (req.headers.origin) return req.headers.origin.toString().replace(/\/$/, "");
  if (req.headers.referer) {
    try {
      const url = new URL(req.headers.referer as string);
      return `${url.protocol}//${url.host}`;
    } catch (e) { /* skip invalid referer */ }
  }
  
  // Last resort: Host header or localhost
  const host = req.headers.host;
  return host ? `https://${host}` : `http://localhost:${PORT}`;
}

app.post("/api/paystack/initialize-order", async (req, res) => {
  const { email, amount, itemId, itemName, userId } = req.body;
  const reference = `ORD-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  
  console.log(`[PAYSTACK] Order request for ${email}, item: ${itemName}`);
  
  if (!PAYSTACK_SECRET) return res.status(500).json({ error: "Paystack secret key is missing." });

  try {
    const origin = getOrigin(req);
    const cleanAmount = Math.round(Number(amount));
      
    const payload = {
      email, 
      amount: cleanAmount,
      reference,
      callback_url: `${origin}/?paystack_success=true&order_type=item&item_id=${itemId}&ref=${reference}`,
      metadata: { userId, itemId, itemName, type: 'marketplace_item' },
      channels: ['card', 'bank', 'ussd', 'qr', 'mobile_money', 'bank_transfer']
    };

    const response = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: { 
        "Authorization": `Bearer ${PAYSTACK_SECRET}`, 
        "Content-Type": "application/json" 
      },
      body: JSON.stringify(payload)
    });

    const data: any = await response.json();
    if (response.ok && data.status) {
      res.json(data.data);
    } else {
      res.status(response.status).json({ error: data.message || "Failed to initialize order." });
    }
  } catch (error: any) {
    console.error("[PAYSTACK ERROR]", error.message);
    res.status(500).json({ error: "External payment service error: " + error.message });
  }
});

app.post("/api/paystack/initialize", async (req, res) => {
  try {
    const { email, amount, plan, userId } = req.body;
    const reference = `SUB-${plan}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

    console.log(`[PAYSTACK] Sub request for ${email}, plan: ${plan}, amount: ${amount}`);
    
    if (!PAYSTACK_SECRET || PAYSTACK_SECRET.length < 5) {
      return res.status(500).json({ 
        error: "Paystack secret key is missing. Please set PAYSTACK_SECRET_KEY in environment variables." 
      });
    }

    const origin = getOrigin(req);
    const cleanAmount = Math.round(Number(amount));
    
    const payload = {
      email, 
      amount: cleanAmount,
      reference,
      callback_url: `${origin}/?paystack_success=true&plan=${plan}&ref=${reference}`,
      metadata: { userId, plan, type: 'subscription' },
      channels: ['card', 'bank', 'ussd', 'qr', 'mobile_money', 'bank_transfer']
    };

    console.log("[PAYSTACK] Initializing with Paystack...");
    const response = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: { 
        "Authorization": `Bearer ${PAYSTACK_SECRET}`, 
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const data: any = await response.json();

    if (response.ok && data.status) {
      console.log(`[PAYSTACK] Success: ${data.data.reference}`);
      return res.json(data.data);
    } else {
      console.error("[PAYSTACK] API Error:", data);
      return res.status(response.status).json({ 
        error: data.message || "Failed to initialize transaction." 
      });
    }
  } catch (error: any) {
    console.error("[PAYSTACK CRITICAL ERROR]", error.message);
    res.status(500).json({ error: "External payment service error: " + error.message });
  }
});

app.get("/api/paystack/banks", async (req, res) => {
  if (!PAYSTACK_SECRET) return res.status(500).json({ error: "Secret missing" });
  try {
    const response = await fetch("https://api.paystack.co/bank?country=nigeria&per_page=100", {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` }
    });
    const data: any = await response.json();
    res.json(data.data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/paystack/resolve-account", async (req, res) => {
  const { account_number, bank_code } = req.query;
  if (!PAYSTACK_SECRET) return res.status(500).json({ error: "Secret missing" });
  try {
    const response = await fetch(`https://api.paystack.co/bank/resolve?account_number=${account_number}&bank_code=${bank_code}`, {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` }
    });
    const data: any = await response.json();
    if (response.ok && data.status) {
      res.json(data.data);
    } else {
      res.status(response.status).json({ error: data.message || "Failed to resolve account" });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/paystack/transfer", async (req, res) => {
  const { amount, account_number, bank_code, account_name, userId } = req.body;
  if (!PAYSTACK_SECRET) return res.status(500).json({ error: "Secret missing" });
  
  try {
    const recipientRes = await fetch("https://api.paystack.co/transferrecipient", {
      method: "POST",
      headers: { 
        "Authorization": `Bearer ${PAYSTACK_SECRET}`, 
        "Content-Type": "application/json" 
      },
      body: JSON.stringify({
        type: "nuban", name: account_name, account_number, bank_code, currency: "NGN"
      })
    });
    const recipientData: any = await recipientRes.json();
    
    if (!recipientRes.ok || !recipientData.status) {
      return res.status(recipientRes.status).json({ error: recipientData.message || "Failed to create recipient" });
    }

    const transferRes = await fetch("https://api.paystack.co/transfer", {
      method: "POST",
      headers: { 
        "Authorization": `Bearer ${PAYSTACK_SECRET}`, 
        "Content-Type": "application/json" 
      },
      body: JSON.stringify({
        source: "balance", 
        amount: Math.round(Number(amount)), 
        recipient: recipientData.data.recipient_code, 
        reason: `Withdrawal ${userId}`
      })
    });
    const transferData = await transferRes.json();
    res.json(transferData);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
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
