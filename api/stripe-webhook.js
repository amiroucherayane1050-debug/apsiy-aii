import Stripe from "stripe";

import { getSupabaseAdmin } from "../lib/supabase-admin.js";

export const config = {
  api: {
    bodyParser: false,
  },
};

function stripeClient() {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const mode = process.env.STRIPE_MODE || "test";

  if (!secretKey || !process.env.STRIPE_WEBHOOK_SECRET) {
    throw new Error("Configuration Stripe webhook incomplète.");
  }

  if (mode !== "live" && !secretKey.startsWith("sk_test_")) {
    throw new Error("Une clé Stripe de test est requise.");
  }

  return new Stripe(secretKey);
}

async function rawBody(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Méthode non autorisée" });
  }

  let event;

  try {
    const signature = req.headers["stripe-signature"];
    const stripe = stripeClient();
    const payload = await rawBody(req);

    if (typeof signature !== "string") {
      return res.status(400).json({ error: "Signature Stripe manquante." });
    }

    event = stripe.webhooks.constructEvent(
      payload,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET,
    );
  } catch (error) {
    console.error("Invalid Stripe webhook", error);
    return res.status(400).json({ error: "Webhook Stripe invalide." });
  }

  const isPaidCheckout =
    event.type === "checkout.session.async_payment_succeeded" ||
    (event.type === "checkout.session.completed" &&
      event.data.object.payment_status === "paid");

  if (!isPaidCheckout) {
    return res.status(200).json({ received: true });
  }

  try {
    const session = event.data.object;
    const userId = session.metadata?.user_id || session.client_reference_id;
    const credits = Number.parseInt(session.metadata?.credits || "", 10);

    if (!userId || credits !== 5) {
      throw new Error("Métadonnées de paiement invalides.");
    }

    const supabase = getSupabaseAdmin();
    const { error } = await supabase.rpc("grant_credits", {
      p_user_id: userId,
      p_amount: credits,
      p_external_id: `stripe:${session.id}`,
    });

    if (error) throw error;

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error("Unable to grant Stripe credits", error);
    return res.status(500).json({ error: "Crédits non attribués." });
  }
}
