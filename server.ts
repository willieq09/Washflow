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

// Paystack Configuration
const PAYSTACK_SECRET = (process.env.PAYSTACK_SECRET_KEY || process.env.PAYSTACK_SECRET || "").trim();

console.log(`[SERVER] Startup. Paystack Secret configured: ${!!PAYSTACK_SECRET}`);

// Nodemailer Lazy Initialization
let transporter: nodemailer.Transporter | null = null;
function getTransporter() {
  if (!transporter) {
    const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
    if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) return null;
    try {
      transporter = nodemailer.createTransport({
        host: SMTP_HOST,
        port: parseInt(SMTP_PORT),
        secure: parseInt(SMTP_PORT) === 465,
        auth: { user: SMTP_USER, pass: SMTP_PASS },
      });
    } catch (e) {
      console.error("[MAIL] Error creating transporter:", e);
      return null;
    }
  }
  return transporter;
}

// Async wrapper to replace express-async-errors
const asyncHandler = (fn: any) => (req: any, res: any, next: any) => {
  return Promise.resolve(fn(req, res, next)).catch(next);
};

// API Routes
app.get("/api/health", (req, res) => {
  res.json({ 
    status: "ok", 
    timestamp: new Date().toISOString(),
    paystack_configured: !!PAYSTACK_SECRET,
    node_env: process.env.NODE_ENV || 'development'
  });
});

app.get("/api/paystack/test-connectivity", asyncHandler(async (req: any, res: any) => {
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
}));

app.get("/api/paystack/debug", (req, res) => {
  res.json({
    has_secret: !!PAYSTACK_SECRET,
    filtered_env: Object.keys(process.env).filter(k => k.includes('PAYSTACK'))
  });
});

app.post("/api/notify", asyncHandler(async (req: any, res: any) => {
  const { to, subject, html } = req.body;
  const mailTransporter = getTransporter();
  if (!mailTransporter) return res.status(503).json({ error: "Email service not configured" });

  const info = await mailTransporter.sendMail({
    from: process.env.SMTP_FROM || `"NearWash System" <${process.env.SMTP_USER}>`,
    to, subject, html,
  });
  res.json({ success: true, messageId: info.messageId });
}));

function getOrigin(req: express.Request) {
  const forwardedHost = req.headers['x-forwarded-host'];
  const forwardedProto = req.headers['x-forwarded-proto'] || 'https';
  
  if (forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`.replace(/\/$/, "");
  }

  if (req.headers.origin) return req.headers.origin.toString().replace(/\/$/, "");
  if (req.headers.referer) {
    try {
      const url = new URL(req.headers.referer as string);
      return `${url.protocol}//${url.host}`;
    } catch (e) { /* ignore */ }
  }
  
  const host = req.headers.host;
  return host ? `https://${host}` : `http://localhost:${PORT}`;
}

app.post("/api/paystack/initialize-order", asyncHandler(async (req: any, res: any) => {
  const { email, amount, itemId, itemName, userId } = req.body;
  const reference = `ORD-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  
  if (!PAYSTACK_SECRET) return res.status(500).json({ error: "Paystack secret key is missing." });

  const origin = getOrigin(req);
  const cleanAmount = Math.round(Number(amount));
    
  const response = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: { 
      "Authorization": `Bearer ${PAYSTACK_SECRET}`, 
      "Content-Type": "application/json" 
    },
    body: JSON.stringify({
      email, 
      amount: cleanAmount,
      reference,
      callback_url: `${origin}/?paystack_success=true&order_type=item&item_id=${itemId}&ref=${reference}`,
      metadata: { userId, itemId, itemName, type: 'marketplace_item' },
      channels: ['card', 'bank', 'ussd', 'qr', 'mobile_money', 'bank_transfer']
    })
  });

  const data: any = await response.json();
  if (response.ok && data.status) {
    res.json(data.data);
  } else {
    res.status(response.status).json({ error: data.message || "Failed to initialize order." });
  }
}));

app.post("/api/paystack/initialize", asyncHandler(async (req: any, res: any) => {
  const { email, amount, plan, userId } = req.body;
  const reference = `SUB-${plan}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

  if (!PAYSTACK_SECRET) {
    return res.status(500).json({ error: "Paystack secret key is missing." });
  }

  const origin = getOrigin(req);
  const cleanAmount = Math.round(Number(amount));
  
  const response = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: { 
      "Authorization": `Bearer ${PAYSTACK_SECRET}`, 
      "Content-Type": "application/json" 
    },
    body: JSON.stringify({
      email, 
      amount: cleanAmount,
      reference,
      callback_url: `${origin}/?paystack_success=true&plan=${plan}&ref=${reference}`,
      metadata: { userId, plan, type: 'subscription' },
      channels: ['card', 'bank', 'ussd', 'qr', 'mobile_money', 'bank_transfer']
    })
  });

  const data: any = await response.json();
  if (response.ok && data.status) {
    return res.json(data.data);
  } else {
    return res.status(response.status).json({ error: data.message || "Failed to initialize subscription." });
  }
}));

app.get("/api/paystack/banks", asyncHandler(async (req: any, res: any) => {
  if (!PAYSTACK_SECRET) return res.status(500).json({ error: "Secret missing" });
  const response = await fetch("https://api.paystack.co/bank?country=nigeria&per_page=100", {
    headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` }
  });
  const data: any = await response.json();
  res.json(data.data);
}));

app.get("/api/paystack/resolve-account", asyncHandler(async (req: any, res: any) => {
  const { account_number, bank_code } = req.query;
  if (!PAYSTACK_SECRET) return res.status(500).json({ error: "Secret missing" });
  
  const response = await fetch(`https://api.paystack.co/bank/resolve?account_number=${account_number}&bank_code=${bank_code}`, {
    headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` }
  });
  const data: any = await response.json();
  if (response.ok && data.status) {
    res.json(data.data);
  } else {
    res.status(response.status).json({ error: data.message || "Failed to resolve account" });
  }
}));

app.post("/api/paystack/transfer", asyncHandler(async (req: any, res: any) => {
  const { amount, account_number, bank_code, account_name, userId } = req.body;
  if (!PAYSTACK_SECRET) return res.status(500).json({ error: "Secret missing" });
  
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
  const transferData: any = await transferRes.json();
  res.json(transferData);
}));

const distPath = path.join(process.cwd(), 'dist');
const isProd = process.env.NODE_ENV === "production" || process.env.VERCEL === '1' || fs.existsSync(distPath);

if (isProd) {
  app.use(express.static(distPath));
} else {
  const setupVite = async () => {
    try {
      const { createServer } = await import("vite");
      const v = await createServer({ server: { middlewareMode: true }, appType: "spa" });
      app.use(v.middlewares);
    } catch (e) {
      console.error("[VITE] Failed to load:", e);
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

// Final Error Handler
app.use((err: any, req: any, res: any, next: any) => {
  console.error("[ERROR]", err.message || err);
  if (!res.headersSent) {
    res.status(500).json({ error: err.message || "Internal Server Error" });
  }
});

if (process.env.VERCEL !== '1') {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[SERVER] http://localhost:${PORT}`);
  });
}

export default app;
