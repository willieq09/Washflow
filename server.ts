import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import axios from "axios";
import { fileURLToPath } from 'url';
import nodemailer from 'nodemailer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json());

// Paystack Configuration
const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;

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
    return res.status(500).json({ error: "Paystack is not configured." });
  }

  try {
    const origin = req.headers.origin || req.headers.referer || `http://localhost:${PORT}`;
    
    const response = await axios.post(
      "https://api.paystack.co/transaction/initialize",
      {
        email,
        amount: amount, 
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
    res.status(500).json({ error: error.response?.data?.message || "Failed to initialize order" });
  }
});

app.post("/api/paystack/initialize", async (req, res) => {
  const { email, amount, plan, userId } = req.body;
  
  if (!PAYSTACK_SECRET) {
    return res.status(500).json({ error: "Paystack is not configured." });
  }

  try {
    const origin = req.headers.origin || req.headers.referer || `http://localhost:${PORT}`;
    
    // Paystack initialization
    const response = await axios.post(
      "https://api.paystack.co/transaction/initialize",
      {
        email,
        amount: amount, // In smallest unit (kobo/cents)
        callback_url: `${origin}/?paystack_success=true&plan=${plan}`,
        metadata: {
          userId,
          plan,
          custom_fields: [
            {
              display_name: "Plan",
              variable_name: "plan",
              value: plan
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

    res.json(response.data.data);
  } catch (error: any) {
    console.error("Paystack Init Error:", error.response?.data || error.message);
    res.status(500).json({ error: error.response?.data?.message || "Failed to initialize Paystack transaction" });
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
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  };
  startVite();
}

// Start listener only if not on Vercel
if (process.env.VERCEL !== '1') {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

export default app;
