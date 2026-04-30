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
      console.warn("SMTP configuration is missing. Emails will not be sent.");
      return null;
    }
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: parseInt(SMTP_PORT),
      secure: parseInt(SMTP_PORT) === 465,
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS,
      },
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

  if (!mailTransporter) {
    return res.status(503).json({ error: "Email service not configured" });
  }

  try {
    const info = await mailTransporter.sendMail({
      from: process.env.SMTP_FROM || `"NearWash System" <${process.env.SMTP_USER}>`,
      to,
      subject,
      html,
    });
    console.log("Email sent:", info.messageId);
    res.json({ success: true, messageId: info.messageId });
  } catch (error: any) {
    console.error("Email send error:", error);
    res.status(500).json({ error: "Failed to send email" });
  }
});

app.options("*", (req, res) => {
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.sendStatus(204);
});

app.post("/api/paystack/initialize-order", async (req, res) => {
  const { email, amount, itemId, itemName, userId } = req.body;
  
  if (!PAYSTACK_SECRET) {
    return res.status(500).json({ error: "Paystack is not configured. Please set PAYSTACK_SECRET_KEY in Environment Variables." });
  }

  try {
    const origin = req.headers.origin || req.headers.referer || `http://localhost:${PORT}`;
    const cleanAmount = Math.round(Number(amount));

    if (isNaN(cleanAmount) || cleanAmount <= 0) {
      return res.status(400).json({ error: "Invalid amount provided." });
    }
    
    const response = await axios.post(
      "https://api.paystack.co/transaction/initialize",
      {
        email,
        amount: cleanAmount,
        callback_url: `${origin}/?paystack_success=true&order_type=item&item_id=${itemId}`,
        metadata: {
          userId,
          itemId,
          itemName,
          type: 'marketplace_item'
        }
      },
      {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET}`,
          "Content-Type": "application/json"
        },
        timeout: 15000
      }
    );

    res.json(response.data.data);
  } catch (error: any) {
    console.error("Paystack Order Init Error:", error.response?.data || error.message);
    res.status(500).json({ error: error.response?.data?.message || error.message || "Failed to initialize order" });
  }
});

app.post("/api/paystack/initialize", async (req, res) => {
  const { email, amount, plan, userId } = req.body;
  
  if (!PAYSTACK_SECRET) {
    return res.status(500).json({ error: "Paystack is not configured. Please set PAYSTACK_SECRET_KEY in Environment Variables." });
  }

  try {
    const origin = req.headers.origin || req.headers.referer || `http://localhost:${PORT}`;
    const cleanAmount = Math.round(Number(amount));

    if (isNaN(cleanAmount) || cleanAmount <= 0) {
      return res.status(400).json({ error: "Invalid amount provided." });
    }
    
    // Paystack initialization
    const response = await axios.post(
      "https://api.paystack.co/transaction/initialize",
      {
        email,
        amount: cleanAmount,
        callback_url: `${origin}/?paystack_success=true&plan=${plan}`,
        metadata: {
          userId,
          plan,
          type: 'subscription'
        }
      },
      {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET}`,
          "Content-Type": "application/json"
        },
        timeout: 15000
      }
    );

    if (response.data && response.data.status) {
      res.json(response.data.data);
    } else {
      throw new Error(response.data?.message || "Paystack initialization failed");
    }
  } catch (error: any) {
    console.error("Paystack Init Error:", error.response?.data || error.message);
    const errorMessage = error.response?.data?.message || error.message || "Failed to initialize Paystack transaction";
    res.status(500).json({ error: errorMessage });
  }
});

app.get("/api/paystack/banks", async (req, res) => {
  if (!PAYSTACK_SECRET) {
    return res.status(500).json({ error: "Paystack secret key is missing." });
  }
  
  try {
    let allBanks: any[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore && page <= 3) { // Limit to 3 pages for speed in serverless
      const response = await axios.get(`https://api.paystack.co/bank?country=nigeria&per_page=100&page=${page}`, {
        headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` },
        timeout: 8000
      });
      
      if (!response.data.status) break;

      const data = response.data.data;
      if (data && Array.isArray(data) && data.length > 0) {
        allBanks = [...allBanks, ...data];
        if (data.length < 100) hasMore = false; else page++;
      } else {
        hasMore = false;
      }
    }
    return res.json(allBanks);
  } catch (error: any) {
    console.error("Fetch Banks Error:", error.response?.data || error.message);
    return res.status(500).json({ error: "Failed to fetch banks" });
  }
});

app.get("/api/paystack/resolve-account", async (req, res) => {
  const { account_number, bank_code } = req.query;
  if (!PAYSTACK_SECRET) return res.status(500).json({ error: "Paystack secret key is missing." });
  if (!account_number || !bank_code) return res.status(400).json({ error: "Missing account_number or bank_code" });

  try {
    const response = await axios.get(`https://api.paystack.co/bank/resolve?account_number=${account_number}&bank_code=${bank_code}`, {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` },
      timeout: 10000
    });
    res.json(response.data.data);
  } catch (error: any) {
    console.error("Account Resolve Error:", error.response?.data || error.message);
    res.status(400).json({ error: error.response?.data?.message || "Could not resolve account" });
  }
});

app.post("/api/paystack/transfer", async (req, res) => {
  const { amount, account_number, bank_code, account_name, userId } = req.body;
  if (!PAYSTACK_SECRET) return res.status(500).json({ error: "Paystack not configured" });

  try {
    const recipientRes = await axios.post("https://api.paystack.co/transferrecipient", {
      type: "nuban",
      name: account_name,
      account_number,
      bank_code,
      currency: "NGN"
    }, {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET}`, "Content-Type": "application/json" },
      timeout: 10000
    });

    const recipientCode = recipientRes.data.data.recipient_code;

    const transferRes = await axios.post("https://api.paystack.co/transfer", {
      source: "balance",
      amount: Math.round(Number(amount)),
      recipient: recipientCode,
      reason: `AutoLux Withdrawal - ${userId}`
    }, {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET}`, "Content-Type": "application/json" },
      timeout: 10000
    });

    res.json(transferRes.data);
  } catch (error: any) {
    console.error("Transfer Error:", error.response?.data || error.message);
    res.status(400).json({ error: error.response?.data?.message || "Transfer failed" });
  }
});

// Middleware & Server Logic
async function configureApp() {
  const distPath = path.join(process.cwd(), 'dist');
  const isProd = process.env.NODE_ENV === "production" || process.env.VERCEL === '1' || fs.existsSync(distPath);

  if (isProd) {
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      const indexPage = path.join(distPath, 'index.html');
      if (fs.existsSync(indexPage)) {
        res.sendFile(indexPage);
      } else {
        res.status(404).send("Application build not found. Please run build.");
      }
    });
  } else {
    try {
      const { createServer: createViteServer } = await import("vite");
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
    } catch (e) {
      console.error("Vite failed to initialize:", e);
    }
  }

  // Global Error Handler - Returns JSON
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error("Global Server Error:", err);
    if (!res.headersSent) {
      res.status(500).json({ 
        error: "Internal Server Error", 
        message: err.message || "An unexpected error occurred on the server.",
        requestId: req.headers['x-request-id'] || 'unknown'
      });
    }
  });

  // Start listener only if not on Vercel
  if (process.env.VERCEL !== '1') {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT} [${isProd ? 'PROD' : 'DEV'}]`);
      console.log(`Paystack Configured: ${PAYSTACK_SECRET ? 'YES (Length: ' + PAYSTACK_SECRET.length + ')' : 'NO'}`);
    });
  }
}

configureApp().catch(err => {
  console.error("Failed to start application:", err);
});

export default app;

