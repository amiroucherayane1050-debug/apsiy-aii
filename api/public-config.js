import { getStripeMode, stripeCheckoutReady } from "../lib/stripe.js";

const CREDIT_PACK = Object.freeze({
  credits: 5,
  amount: 999,
  currency: "EUR",
});

export default function handler(req, res) {
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=60, stale-while-revalidate=300");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Méthode non autorisée" });
  }

  let stripeMode = "unavailable";

  try {
    stripeMode = getStripeMode();
  } catch (error) {
    console.error("Invalid public payment configuration", error);
  }

  return res.status(200).json({
    stripeMode,
    checkoutReady: stripeCheckoutReady(),
    creditPack: CREDIT_PACK,
  });
}
