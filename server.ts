import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import axios from "axios";
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
const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY || process.env.PAYSTACK_SECRET;

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
  res.json({ status: "ok" });
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
    return res.status(500).json({ error: "Paystack is not configured. Please set PAYSTACK_SECRET_KEY." });
  }

  try {
    const origin = req.headers.origin || req.headers.referer || `http://localhost:${PORT}`;
    
    const response = await axios.post(
      "https://api.paystack.co/transaction/initialize",
      {
        email,
        amount: Math.round(amount), // Ensure integer
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
        }
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
    
    // Paystack initialization
    const response = await axios.post(
      "https://api.paystack.co/transaction/initialize",
      {
        email,
        amount: Math.round(amount), // Enforce integer for Paystack (kobo/cents)
        callback_url: `${origin}/?paystack_success=true&plan=${plan}`,
        metadata: {
          userId,
          plan,
          currency: "NGN",
          gross_amount: amount,
          autolux_commission_gross: Math.round(amount * 0.075),
          paystack_fee: amount < 250000 ? Math.round(amount * 0.015) : Math.round(amount * 0.015 + 10000), // in kobo
          owner_payout: Math.round(amount * 0.925),
          custom_fields: [
            {
              display_name: "Plan",
              variable_name: "plan",
              value: plan
            },
            {
              display_name: "AutoLux Fee (7.5%)",
              variable_name: "autolux_fee",
              value: (amount * 0.075 / 100).toFixed(2)
            }
          ]
        }
      },
      {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET}`,
          "Content-Type": "application/json"
        }
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
  if (!PAYSTACK_SECRET) return res.status(500).json({ error: "Paystack not configured" });
  try {
    const response = await axios.get("https://api.paystack.co/bank", {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` }
    });
    res.json(response.data.data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/paystack/resolve-account", async (req, res) => {
  const { account_number, bank_code } = req.query;
  if (!PAYSTACK_SECRET) return res.status(500).json({ error: "Paystack not configured" });
  try {
    const response = await axios.get(`https://api.paystack.co/bank/resolve?account_number=${account_number}&bank_code=${bank_code}`, {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` }
    });
    res.json(response.data.data);
  } catch (error: any) {
    res.status(400).json({ error: error.response?.data?.message || "Could not resolve account" });
  }
});

app.post("/api/paystack/transfer", async (req, res) => {
  const { amount, account_number, bank_code, account_name, userId } = req.body;
  if (!PAYSTACK_SECRET) return res.status(500).json({ error: "Paystack not configured" });

  try {
    // 1. Create Transfer Recipient
    const recipientRes = await axios.post("https://api.paystack.co/transferrecipient", {
      type: "nuban",
      name: account_name,
      account_number: account_number,
      bank_code: bank_code,
      currency: "NGN"
    }, {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET}`, "Content-Type": "application/json" }
    });

    const recipientCode = recipientRes.data.data.recipient_code;

    // 2. Initiate Transfer
    const transferRes = await axios.post("https://api.paystack.co/transfer", {
      source: "balance",
      amount: Math.round(amount), // in kobo
      recipient: recipientCode,
      reason: `AutoLux Withdrawal - ${userId}`
    }, {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET}`, "Content-Type": "application/json" }
    });

    res.json(transferRes.data.data);
  } catch (error: any) {
    console.error("Transfer Error:", error.response?.data || error.message);
    res.status(400).json({ error: error.response?.data?.message || "Transfer failed" });
  }
});

// Production static file serving
if (process.env.NODE_ENV === "production") {
  const distPath = path.join(process.cwd(), 'dist');
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
} else {
  // For development (local or AI Studio preview), we use the async start helper
  const startVite = async () => {
    try {
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
    } catch (e) {
      console.error("Vite middleware failed to start:", e);
    }
  };
  startVite();
}

// Global error handler to ensure JSON responses even on unexpected crashes
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error("Global Server Error:", err);
  res.status(500).json({ 
    error: "A critical server error occurred.", 
    message: err.message || "Unknown error" 
  });
});

// Start listener only if not on Vercel
if (process.env.VERCEL !== '1') {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

export default app;
