import { requireUser } from "../lib/auth.js";
import { getStripeClient } from "../lib/stripe.js";

const CREDIT_PACK_SIZE = 5;
const CREDIT_PACK_PRICE = 999;
const CREDIT_PACK_CURRENCY = "eur";
const CREDIT_PACK_LOOKUP_KEY = "apsiy_starter_5_credits_eur_v1";

async function creditPackPriceId(stripe, mode) {
  if (process.env.STRIPE_PRICE_ID) {
    const price = await stripe.prices.retrieve(process.env.STRIPE_PRICE_ID);

    if (
      !price.active ||
      price.currency !== CREDIT_PACK_CURRENCY ||
      price.unit_amount !== CREDIT_PACK_PRICE
    ) {
      throw new Error("Le prix Stripe configuré ne correspond pas au pack Apsiy Ai.");
    }

    return price.id;
  }

  if (mode === "live") {
    throw new Error("STRIPE_PRICE_ID live manquant.");
  }

  const existingPrices = await stripe.prices.list({
    active: true,
    limit: 1,
    lookup_keys: [CREDIT_PACK_LOOKUP_KEY],
  });

  if (existingPrices.data[0]) {
    return existingPrices.data[0].id;
  }

  const product = await stripe.products.create(
    {
      name: "Starter – 5 crédits",
      description: "Pack de 5 crédits vidéo Apsiy Ai",
      metadata: {
        app: "apsiy-ai",
        credits: String(CREDIT_PACK_SIZE),
      },
    },
    {
      idempotencyKey: "apsiy-starter-5-credits-product-v1",
    },
  );

  const price = await stripe.prices.create(
    {
      active: true,
      currency: CREDIT_PACK_CURRENCY,
      lookup_key: CREDIT_PACK_LOOKUP_KEY,
      product: product.id,
      unit_amount: CREDIT_PACK_PRICE,
    },
    {
      idempotencyKey: "apsiy-starter-5-credits-price-v1",
    },
  );

  return price.id;
}

function appUrl() {
  if (process.env.VERCEL_ENV !== "production" && process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }

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

    if (req.body?.digitalContentConsent !== true) {
      return res.status(400).json({
        error: "Confirme l’exécution immédiate du service avant de payer.",
      });
    }

    const baseUrl = appUrl();
    const { mode, stripe } = getStripeClient();
    const priceId = await creditPackPriceId(stripe, mode);
    const metadata = {
      user_id: user.id,
      credits: String(CREDIT_PACK_SIZE),
      digital_content_consent: "true",
      consented_at: new Date().toISOString(),
    };

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: user.id,
      customer_email: user.email || undefined,
      metadata,
      payment_intent_data: { metadata },
      custom_text: {
        submit: {
          message:
            "En payant, tu demandes l’exécution immédiate du service numérique. Après utilisation des crédits, tu reconnais perdre ton droit de rétractation.",
        },
      },
      success_url: `${baseUrl}/?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/?payment=cancelled`,
    });

    return res.status(200).json({ url: session.url });
  } catch (error) {
    console.error("Checkout creation failed", error);
    return res.status(503).json({
      error: "Le paiement est momentanément indisponible.",
    });
  }
}
