import express from "express";
import path from "path";
import axios from "axios";
import fs from "fs";
import { fileURLToPath } from 'url';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json());

// Paystack Configuration
const PAYSTACK_SECRET = (process.env.PAYSTACK_SECRET_KEY || process.env.PAYSTACK_SECRET || "").trim();

// Nodemailer Lazy Initialization
let transporter: nodemailer.Transporter | null = null;
function getTransporter() {
  if (!transporter) {
    const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
    if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
      console.warn("SMTP missing");
      return null;
    }
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
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.post("/api/notify", async (req, res) => {
  const { to, subject, html } = req.body;
  const mailTransporter = getTransporter();
  if (!mailTransporter) return res.status(503).json({ error: "Email service not configured" });

  try {
    const info = await mailTransporter.sendMail({
      from: process.env.SMTP_FROM || `"NearWash System" <${process.env.SMTP_USER}>`,
      to, subject, html,
    });
    res.json({ success: true, messageId: info.messageId });
  } catch (error: any) {
    console.error("Email error:", error);
    res.status(500).json({ error: "Failed to send email" });
  }
});

app.post("/api/paystack/initialize-order", async (req, res) => {
  const { email, amount, itemId, itemName, userId } = req.body;
  if (!PAYSTACK_SECRET) return res.status(500).json({ error: "Paystack config missing" });

  try {
    const origin = (req.headers.origin || req.headers.referer || `http://localhost:${PORT}`).replace(/\/$/, "");
    const cleanAmount = Math.round(Number(amount));
    if (isNaN(cleanAmount) || cleanAmount <= 0) return res.status(400).json({ error: "Invalid amount" });
    
    const response = await axios.post("https://api.paystack.co/transaction/initialize", {
      email, amount: cleanAmount,
      callback_url: `${origin}/?paystack_success=true&order_type=item&item_id=${itemId}`,
      metadata: { userId, itemId, itemName, type: 'marketplace_item' }
    }, {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET}`, "Content-Type": "application/json" },
      timeout: 10000
    });
    res.json(response.data.data);
  } catch (error: any) {
    console.error("Init Order Error:", error.response?.data || error.message);
    res.status(500).json({ error: error.response?.data?.message || error.message });
  }
});

app.post("/api/paystack/initialize", async (req, res) => {
  const { email, amount, plan, userId } = req.body;
  if (!PAYSTACK_SECRET) return res.status(500).json({ error: "Paystack secret missing" });

  try {
    const origin = (req.headers.origin || req.headers.referer || `http://localhost:${PORT}`).replace(/\/$/, "");
    const cleanAmount = Math.round(Number(amount));
    if (isNaN(cleanAmount) || cleanAmount <= 0) return res.status(400).json({ error: "Invalid amount" });
    
    const response = await axios.post("https://api.paystack.co/transaction/initialize", {
      email, amount: cleanAmount,
      callback_url: `${origin}/?paystack_success=true&plan=${plan}`,
      metadata: { userId, plan, type: 'subscription' }
    }, {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET}`, "Content-Type": "application/json" },
      timeout: 10000
    });
    if (response.data?.status) res.json(response.data.data);
    else throw new Error(response.data?.message || "Init failed");
  } catch (error: any) {
    console.error("Init Subscribe Error:", error.response?.data || error.message);
    res.status(500).json({ error: error.response?.data?.message || error.message });
  }
});

app.get("/api/paystack/banks", async (req, res) => {
  if (!PAYSTACK_SECRET) return res.status(500).json({ error: "Secret missing" });
  try {
    const response = await axios.get(`https://api.paystack.co/bank?country=nigeria&per_page=100`, {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` },
      timeout: 8000
    });
    res.json(response.data.data);
  } catch (error: any) {
    res.status(500).json({ error: "Bank fetch failed" });
  }
});

app.get("/api/paystack/resolve-account", async (req, res) => {
  const { account_number, bank_code } = req.query;
  if (!PAYSTACK_SECRET) return res.status(500).json({ error: "Secret missing" });
  try {
    const resPay = await axios.get(`https://api.paystack.co/bank/resolve?account_number=${account_number}&bank_code=${bank_code}`, {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` },
      timeout: 10000
    });
    res.json(resPay.data.data);
  } catch (error: any) {
    res.status(400).json({ error: error.response?.data?.message || "Resolve failed" });
  }
});

app.post("/api/paystack/transfer", async (req, res) => {
  const { amount, account_number, bank_code, account_name, userId } = req.body;
  if (!PAYSTACK_SECRET) return res.status(500).json({ error: "Secret missing" });
  try {
    const recipientRes = await axios.post("https://api.paystack.co/transferrecipient", {
      type: "nuban", name: account_name, account_number, bank_code, currency: "NGN"
    }, {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET}`, "Content-Type": "application/json" },
      timeout: 10000
    });
    const transferRes = await axios.post("https://api.paystack.co/transfer", {
      source: "balance", amount: Math.round(Number(amount)), recipient: recipientRes.data.data.recipient_code, reason: `Withdrawal ${userId}`
    }, {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET}`, "Content-Type": "application/json" },
      timeout: 10000
    });
    res.json(transferRes.data);
  } catch (error: any) {
    res.status(400).json({ error: error.response?.data?.message || "Transfer failed" });
  }
});

// Deployment logic
const distPath = path.join(process.cwd(), 'dist');
const isProd = process.env.NODE_ENV === "production" || process.env.VERCEL === '1' || fs.existsSync(distPath);

if (isProd) {
  app.use(express.static(distPath));
} else {
  import("vite").then(({ createServer }) => {
    createServer({ server: { middlewareMode: true }, appType: "spa" }).then(v => app.use(v.middlewares));
  }).catch(e => console.error(e));
}

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  if (isProd && fs.existsSync(path.join(distPath, 'index.html'))) {
    res.sendFile(path.join(distPath, 'index.html'));
  } else {
    next();
  }
});

if (process.env.VERCEL !== '1') {
  app.listen(PORT, "0.0.0.0", () => console.log(`Server on ${PORT} [${isProd?'PROD':'DEV'}]`));
}

export default app;
