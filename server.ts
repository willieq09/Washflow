import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import Stripe from "stripe";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json());

// Stripe Initialization
let stripe: Stripe | null = null;
if (process.env.STRIPE_SECRET_KEY) {
  stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
}

// API Routes
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

app.options("*", (req, res) => {
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.sendStatus(204);
});

app.post("/api/create-checkout-session", async (req, res) => {
  console.log(`[STRIPE] Creating session for ${req.body.userEmail} - Plan: ${req.body.plan}`);
  try {
    const { plan, userId, userEmail } = req.body;
    
    if (!stripe) {
      return res.status(500).json({ error: "Stripe is not configured." });
    }

    const plans = {
      starter: { name: "AutoLux Operator Starter", price: 1900 },
      standard: { name: "AutoLux Operator Professional", price: 4900 },
      elite: { name: "AutoLux Operator Elite", price: 9900 },
    };

    const selectedPlan = plans[plan as keyof typeof plans];
    if (!selectedPlan) {
      return res.status(400).json({ error: `Invalid plan: ${plan}` });
    }

    const origin = req.headers.origin || req.headers.referer || `http://localhost:${PORT}`;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: selectedPlan.name,
              description: `Subscription for ${selectedPlan.name}`,
            },
            unit_amount: selectedPlan.price,
            recurring: { interval: "month" },
          },
          quantity: 1,
        },
      ],
      mode: "subscription",
      success_url: `${origin}/?session_id={CHECKOUT_SESSION_ID}&success=true&plan=${plan}`,
      cancel_url: `${origin}/?canceled=true`,
      customer_email: userEmail,
      metadata: {
        userId: userId,
        plan: plan,
      },
    });

    return res.json({ url: session.url });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
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
