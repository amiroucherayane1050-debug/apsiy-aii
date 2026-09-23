import Stripe from "stripe";

import { requireUser } from "../lib/auth.js";

const CREDIT_PACK_SIZE = 5;

function stripeClient() {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const mode = process.env.STRIPE_MODE || "test";

  if (!secretKey) {
    throw new Error("Configuration Stripe incomplète.");
  }

  if (mode !== "live" && !secretKey.startsWith("sk_test_")) {
    throw new Error("Une clé Stripe de test est requise.");
  }

  return new Stripe(secretKey);
}

function appUrl() {
  const value = process.env.APP_URL;

  if (!value) {
    throw new Error("APP_URL manquant.");
  }

  return value.replace(/\/$/, "");
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Méthode non autorisée" });
  }

  try {
    const user = await requireUser(req, res);
    if (!user) return;

    const priceId = process.env.STRIPE_PRICE_ID;
    if (!priceId) {
      throw new Error("STRIPE_PRICE_ID manquant.");
    }

    const baseUrl = appUrl();
    const stripe = stripeClient();
    const metadata = {
      user_id: user.id,
      credits: String(CREDIT_PACK_SIZE),
    };

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: user.id,
      customer_email: user.email || undefined,
      metadata,
      payment_intent_data: { metadata },
      success_url: `${baseUrl}/?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/?payment=cancelled`,
    });

    return res.status(200).json({ url: session.url });
  } catch (error) {
    console.error("Checkout creation failed", error);
    return res.status(503).json({
      error: "Le paiement de test est momentanément indisponible.",
    });
  }
}
