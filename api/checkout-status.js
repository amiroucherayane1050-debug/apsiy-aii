import Stripe from "stripe";

import { requireUser } from "../lib/auth.js";
import { getSupabaseAdmin } from "../lib/supabase-admin.js";

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

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Méthode non autorisée" });
  }

  try {
    const user = await requireUser(req, res);
    if (!user) return;

    const sessionId =
      typeof req.query.sessionId === "string" ? req.query.sessionId : "";
    const expectedPrefix = (process.env.STRIPE_MODE || "test") === "live"
      ? "cs_live_"
      : "cs_test_";

    if (!sessionId.startsWith(expectedPrefix)) {
      return res.status(400).json({ error: "Session de paiement invalide." });
    }

    const session = await stripeClient().checkout.sessions.retrieve(sessionId);
    const sessionUserId = session.metadata?.user_id || session.client_reference_id;

    if (sessionUserId !== user.id) {
      return res.status(404).json({ error: "Session de paiement introuvable." });
    }

    if (session.payment_status !== "paid") {
      return res.status(200).json({ paid: false });
    }

    const purchasedCredits = Number.parseInt(session.metadata?.credits || "", 10);
    if (purchasedCredits !== 5) {
      throw new Error("Métadonnées de paiement invalides.");
    }

    const supabase = getSupabaseAdmin();
    const { data: credits, error } = await supabase.rpc("grant_credits", {
      p_user_id: user.id,
      p_amount: purchasedCredits,
      p_external_id: `stripe:${session.id}`,
    });

    if (error) throw error;

    const balance = Number(credits);
    if (!Number.isInteger(balance) || balance < 0) {
      throw new Error("Solde invalide après attribution Stripe.");
    }

    return res.status(200).json({ paid: true, credits: balance });
  } catch (error) {
    console.error("Checkout verification failed", error);
    return res.status(503).json({
      error: "Impossible de vérifier le paiement pour le moment.",
    });
  }
}
