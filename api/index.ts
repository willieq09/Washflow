import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from 'url';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import cors from 'cors';
import axios from 'axios';

// Load environment variables if not on Vercel
if (process.env.VERCEL !== '1') {
  dotenv.config();
}

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

const PAYSTACK_SECRET = (process.env.PAYSTACK_SECRET_KEY || process.env.PAYSTACK_SECRET || "").trim();

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
      console.error("[MAIL] Error:", e);
      return null;
    }
  }
  return transporter;
}

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", paystack: !!PAYSTACK_SECRET });
});

app.get("/api/config", (req, res) => {
  res.json({
    tomtom_api_key: (process.env.TOMTOM_API_KEY || process.env.VITE_TOMTOM_API_KEY || "").trim()
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
      data: response.data 
    });
  } catch (error: any) {
    res.status(500).json({ 
      error: error.message,
      data: error.response?.data 
    });
  }
});

app.get("/api/paystack/debug", (req, res) => {
  res.json({
    has_secret: !!PAYSTACK_SECRET,
    secret_len: PAYSTACK_SECRET.length,
    env: process.env.NODE_ENV,
    vercel: !!process.env.VERCEL,
    time: new Date().toISOString()
  });
});

app.post("/api/notify", async (req, res) => {
  try {
    const { to, subject, html } = req.body;
    const mailTransporter = getTransporter();
    if (!mailTransporter) return res.status(503).json({ error: "Email service not configured" });

    const info = await mailTransporter.sendMail({
      from: process.env.SMTP_FROM || `"NearWash" <${process.env.SMTP_USER}>`,
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
  if (forwardedHost) return `${forwardedProto}://${forwardedHost}`.replace(/\/$/, "");
  if (req.headers.origin) return req.headers.origin.toString().replace(/\/$/, "");
  const host = req.headers.host;
  return host ? `https://${host}` : `http://localhost:${PORT}`;
}

app.post("/api/paystack/initialize-order", async (req, res) => {
  try {
    const { email, amount, itemId, itemName, userId, businessId, ownerUid } = req.body;
    const reference = `ORD-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    if (!PAYSTACK_SECRET) return res.status(500).json({ error: "Secret missing" });
    const origin = getOrigin(req);
    
    const response = await axios.post("https://api.paystack.co/transaction/initialize", {
      email, 
      amount: Math.round(Number(amount)), 
      currency: "NGN",
      reference,
      callback_url: `${origin}/?paystack_success=true&order_type=item&item_id=${itemId}&ref=${reference}`,
      metadata: { userId, itemId, itemName, businessId, ownerUid, type: 'marketplace_item' },
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
      res.status(400).json({ error: response.data?.message || "Failed" });
    }
  } catch (error: any) {
    res.status(error.response?.status || 500).json({ error: error.response?.data?.message || error.message });
  }
});

app.post("/api/paystack/initialize", async (req, res) => {
  try {
    const { email, amount, plan, userId } = req.body;
    const reference = `SUB-${plan}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    if (!PAYSTACK_SECRET) return res.status(500).json({ error: "Secret missing" });
    const origin = getOrigin(req);

    const response = await axios.post("https://api.paystack.co/transaction/initialize", {
      email, 
      amount: Math.round(Number(amount)), 
      currency: "NGN",
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
      res.json(response.data.data);
    } else {
      res.status(400).json({ error: response.data?.message || "Failed" });
    }
  } catch (error: any) {
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
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/paystack/resolve-account", async (req, res) => {
  try {
    const { account_number, bank_code } = req.query;
    if (!PAYSTACK_SECRET) return res.status(500).json({ error: "Secret missing" });
    const response = await axios.get(`https://api.paystack.co/bank/resolve?account_number=${account_number}&bank_code=${bank_code}`, {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` }
    });
    if (response.data && response.data.status) res.json(response.data.data);
    else res.status(400).json({ error: response.data?.message });
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
      headers: { "Authorization": `Bearer ${PAYSTACK_SECRET}`, "Content-Type": "application/json" }
    });
    
    if (!recipientRes.data.status) return res.status(400).json({ error: recipientRes.data.message });

    const transferRes = await axios.post("https://api.paystack.co/transfer", {
      source: "balance", 
      amount: Math.round(Number(amount)), 
      recipient: recipientRes.data.data.recipient_code, 
      reason: `Withdrawal ${userId}`
    }, {
      headers: { "Authorization": `Bearer ${PAYSTACK_SECRET}`, "Content-Type": "application/json" }
    });
    res.json(transferRes.data);
  } catch (error: any) {
    res.status(error.response?.status || 500).json({ error: error.message });
  }
});

app.get("/api/paystack/verify/:reference", async (req, res) => {
  try {
    const { reference } = req.params;
    if (!PAYSTACK_SECRET) return res.status(500).json({ error: "Secret missing" });
    
    const response = await axios.get(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` }
    });
    
    if (response.data && response.data.status) {
      res.json(response.data.data);
    } else {
      res.status(400).json({ error: response.data?.message || "Failed to verify transaction" });
    }
  } catch (error: any) {
    res.status(error.response?.status || 500).json({ error: error.response?.data?.message || error.message });
  }
});

// Final error handler
app.use((err: any, req: any, res: any, next: any) => {
  console.error("[SERVER ERROR]", err);
  if (!res.headersSent) {
    res.status(500).json({ error: "Internal Server Error" });
  }
});

export default app;

