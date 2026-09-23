import Stripe from "stripe";

const SUPPORTED_MODES = new Set(["test", "live"]);

export function getStripeMode() {
  const mode = process.env.STRIPE_MODE || "test";

  if (!SUPPORTED_MODES.has(mode)) {
    throw new Error("STRIPE_MODE doit valoir test ou live.");
  }

  return mode;
}

export function getStripeClient({ requireWebhookSecret = false } = {}) {
  const mode = getStripeMode();
  const secretKey = process.env.STRIPE_SECRET_KEY || "";
  const expectedPrefix = mode === "live" ? "sk_live_" : "sk_test_";

  if (!secretKey) {
    throw new Error("Configuration Stripe incomplète.");
  }

  if (!secretKey.startsWith(expectedPrefix)) {
    throw new Error(`La clé Stripe ne correspond pas au mode ${mode}.`);
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "";
  if (requireWebhookSecret && !webhookSecret.startsWith("whsec_")) {
    throw new Error("Configuration Stripe webhook incomplète.");
  }

  return {
    mode,
    stripe: new Stripe(secretKey),
    webhookSecret,
  };
}

export function stripeCheckoutReady() {
  try {
    const mode = getStripeMode();
    const secretKey = process.env.STRIPE_SECRET_KEY || "";
    const expectedPrefix = mode === "live" ? "sk_live_" : "sk_test_";
    const hasValidKey = secretKey.startsWith(expectedPrefix);
    const hasWebhook = (process.env.STRIPE_WEBHOOK_SECRET || "").startsWith("whsec_");
    const hasLivePrice = mode !== "live" || (process.env.STRIPE_PRICE_ID || "").startsWith("price_");

    return hasValidKey && hasWebhook && hasLivePrice;
  } catch {
    return false;
  }
}
