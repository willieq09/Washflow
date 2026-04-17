import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import Stripe from "stripe";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  let stripe: Stripe | null = null;
  if (process.env.STRIPE_SECRET_KEY) {
    stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  }

  app.use(express.json());

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.post("/api/create-checkout-session", async (req, res) => {
    try {
      const { plan, userId, userEmail } = req.body;
      console.log(`[Stripe] Creating session for ${userEmail} (Plan: ${plan})`);
      
      if (!stripe) {
        console.error("[Stripe] Missing API Key");
        return res.status(500).json({ error: "Stripe is not configured. Please add STRIPE_SECRET_KEY to Settings > Secrets." });
      }

      if (!plan || !userId || !userEmail) {
        return res.status(400).json({ error: "Missing required fields: plan, userId, or userEmail" });
      }

      const plans = {
        starter: { name: "WashFlow Starter", price: 1900 },
        standard: { name: "WashFlow Professional", price: 4900 },
        elite: { name: "WashFlow Elite", price: 9900 },
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
                description: `Subscription for ${selectedPlan.name} plan`,
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

      console.log("[Stripe] Session created:", session.id);
      return res.json({ url: session.url });
    } catch (error: any) {
      console.error("[Stripe] Error:", error.message);
      return res.status(500).json({ error: error.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
