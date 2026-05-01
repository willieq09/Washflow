import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from 'url';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import cors from 'cors';
import axios from 'axios';

// Global error handlers to prevent silent crashes
process.on('unhandledRejection', (reason, promise) => {
  console.error('[CRITICAL] Unhandled Rejection:', reason);
});

process.on('uncaughtException', (err, origin) => {
  console.error('[CRITICAL] Uncaught Exception:', err);
});

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

// API Routes
app.get("/api/health", (req, res) => {
  res.json({ 
    status: "ok", 
    timestamp: new Date().toISOString(),
    paystack_configured: !!PAYSTACK_SECRET,
    node_env: process.env.NODE_ENV || 'development'
  });
});

app.get("/api/paystack/test-connectivity", async (req, res) => {
  try {
    const response = await axios.get("https://api.paystack.co/bank", {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` },
      timeout: 10000
    });
    res.json({ 
      can_reach_paystack: true, 
      status: response.status, 
      paystack_status: response.data.status,
      message: response.data.message
    });
  } catch (error: any) {
    res.status(500).json({ 
      can_reach_paystack: false, 
      error: error.message,
      data: error.response?.data
    });
  }
});

app.get("/api/paystack/debug", (req, res) => {
  res.json({
    status: "ok",
    has_secret: !!PAYSTACK_SECRET,
    secret_is_valid: !!(PAYSTACK_SECRET && PAYSTACK_SECRET.length > 10),
    node_env: process.env.NODE_ENV,
    node_version: process.version,
    is_vercel: !!process.env.VERCEL,
    cwd: process.cwd(),
    time: new Date().toISOString()
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

app.post("/api/paystack/initialize-order", async (req, res) => {
  try {
    const { email, amount, itemId, itemName, userId } = req.body;
    const reference = `ORD-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    
    if (!PAYSTACK_SECRET) return res.status(500).json({ error: "Paystack secret key is missing." });

    const origin = getOrigin(req);
    const cleanAmount = Math.round(Number(amount));
      
    const response = await axios.post("https://api.paystack.co/transaction/initialize", {
      email, 
      amount: cleanAmount,
      reference,
      callback_url: `${origin}/?paystack_success=true&order_type=item&item_id=${itemId}&ref=${reference}`,
      metadata: { userId, itemId, itemName, type: 'marketplace_item' },
      channels: ['card', 'bank', 'ussd', 'qr', 'mobile_money', 'bank_transfer']
    }, {
      headers: { 
        "Authorization": `Bearer ${PAYSTACK_SECRET}`, 
        "Content-Type": "application/json" 
      }
    });

    if (response.data && response.data.status) {
      res.json(response.data.data);
    } else {
      res.status(400).json({ error: response.data?.message || "Failed to initialize order." });
    }
  } catch (error: any) {
    console.error("[PAYSTACK ERROR]", error.response?.data || error.message);
    res.status(error.response?.status || 500).json({ error: error.response?.data?.message || error.message });
  }
});

app.post("/api/paystack/initialize", async (req, res) => {
  try {
    const { email, amount, plan, userId } = req.body;
    const reference = `SUB-${plan}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

    if (!PAYSTACK_SECRET) {
      return res.status(500).json({ error: "Paystack secret key is missing." });
    }

    const origin = getOrigin(req);
    const cleanAmount = Math.round(Number(amount));
    
    const response = await axios.post("https://api.paystack.co/transaction/initialize", {
      email, 
      amount: cleanAmount,
      reference,
      callback_url: `${origin}/?paystack_success=true&plan=${plan}&ref=${reference}`,
      metadata: { userId, plan, type: 'subscription' },
      channels: ['card', 'bank', 'ussd', 'qr', 'mobile_money', 'bank_transfer']
    }, {
      headers: { 
        "Authorization": `Bearer ${PAYSTACK_SECRET}`, 
        "Content-Type": "application/json" 
      }
    });

    if (response.data && response.data.status) {
      return res.json(response.data.data);
    } else {
      return res.status(400).json({ error: response.data?.message || "Failed to initialize subscription." });
    }
  } catch (error: any) {
    console.error("[PAYSTACK ERROR]", error.response?.data || error.message);
    res.status(error.response?.status || 500).json({ error: error.response?.data?.message || error.message });
  }
});

app.get("/api/paystack/banks", async (req, res) => {
  try {
    if (!PAYSTACK_SECRET) return res.status(500).json({ error: "Secret missing" });
    const response = await axios.get("https://api.paystack.co/bank?country=nigeria&per_page=100", {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` }
    });
    res.json(response.data.data);
  } catch (error: any) {
    res.status(error.response?.status || 500).json({ error: error.message });
  }
});

app.get("/api/paystack/resolve-account", async (req, res) => {
  try {
    const { account_number, bank_code } = req.query;
    if (!PAYSTACK_SECRET) return res.status(500).json({ error: "Secret missing" });
    
    const response = await axios.get(`https://api.paystack.co/bank/resolve?account_number=${account_number}&bank_code=${bank_code}`, {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` }
    });
    if (response.data && response.data.status) {
      res.json(response.data.data);
    } else {
      res.status(400).json({ error: response.data?.message || "Failed to resolve account" });
    }
  } catch (error: any) {
    res.status(error.response?.status || 500).json({ error: error.message });
  }
});

app.post("/api/paystack/transfer", async (req, res) => {
  try {
    const { amount, account_number, bank_code, account_name, userId } = req.body;
    if (!PAYSTACK_SECRET) return res.status(500).json({ error: "Secret missing" });
    
    const recipientRes = await axios.post("https://api.paystack.co/transferrecipient", {
      type: "nuban", name: account_name, account_number, bank_code, currency: "NGN"
    }, {
      headers: { 
        "Authorization": `Bearer ${PAYSTACK_SECRET}`, 
        "Content-Type": "application/json" 
      }
    });
    
    if (!recipientRes.data.status) {
      return res.status(400).json({ error: recipientRes.data.message || "Failed to create recipient" });
    }

    const transferRes = await axios.post("https://api.paystack.co/transfer", {
      source: "balance", 
      amount: Math.round(Number(amount)), 
      recipient: recipientRes.data.data.recipient_code, 
      reason: `Withdrawal ${userId}`
    }, {
      headers: { 
        "Authorization": `Bearer ${PAYSTACK_SECRET}`, 
        "Content-Type": "application/json" 
      }
    });
    res.json(transferRes.data);
  } catch (error: any) {
    res.status(error.response?.status || 500).json({ error: error.message });
  }
});

const distPath = path.join(process.cwd(), 'dist');
const isProd = process.env.NODE_ENV === "production" || process.env.VERCEL === '1';

if (isProd) {
  if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
  }
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
  
  if (isProd) {
    const indexPath = path.join(distPath, 'index.html');
    if (fs.existsSync(indexPath)) {
      return res.sendFile(indexPath);
    }
  }
  next();
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
