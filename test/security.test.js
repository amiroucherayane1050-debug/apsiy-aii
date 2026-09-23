import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import checkoutStatus from "../api/checkout-status.js";
import createCheckoutSession from "../api/create-checkout-session.js";
import generate from "../api/generate.js";
import history from "../api/history.js";
import me from "../api/me.js";
import publicConfig from "../api/public-config.js";
import status from "../api/status.js";
import stripeWebhook from "../api/stripe-webhook.js";
import { getStripeClient, getStripeMode, stripeCheckoutReady } from "../lib/stripe.js";

function responseRecorder() {
  const result = { body: null, headers: {}, statusCode: null };
  const response = {
    setHeader(name, value) {
      result.headers[name] = value;
      return response;
    },
    status(statusCode) {
      result.statusCode = statusCode;
      return response;
    },
    json(body) {
      result.body = body;
      return response;
    },
  };

  return { response, result };
}

const privateRoutes = [
  ["generate", generate, { method: "POST", body: { prompt: "test vidéo" } }],
  ["history", history, { method: "GET" }],
  ["status", status, { method: "GET", query: { jobId: "job" } }],
  ["me", me, { method: "GET" }],
  ["create checkout", createCheckoutSession, { method: "POST" }],
  ["checkout status", checkoutStatus, { method: "GET", query: {} }],
];

for (const [name, handler, request] of privateRoutes) {
  test(`${name} fails closed without authentication`, async () => {
    const { response, result } = responseRecorder();
    await handler({ headers: {}, query: {}, ...request }, response);

    assert.equal(result.statusCode, 401);
    assert.match(result.body.error, /Connecte-toi/);
  });
}

test("Stripe webhook rejects non-POST methods", async () => {
  const { response, result } = responseRecorder();
  await stripeWebhook({ method: "GET", headers: {} }, response);

  assert.equal(result.statusCode, 405);
  assert.equal(result.headers.Allow, "POST");
});

test("the browser bundle contains no server secret or old live Payment Link", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

  assert.doesNotMatch(html, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(html, /STRIPE_SECRET_KEY/);
  assert.doesNotMatch(html, /buy\.stripe\.com/);
  assert.doesNotMatch(html, /aFadR958V0jidjV2TH7bW01/);
});

test("history is scoped to the authenticated user", async () => {
  const source = await readFile(new URL("../api/history.js", import.meta.url), "utf8");

  assert.match(source, /requireUser/);
  assert.match(source, /\.eq\("user_id", user\.id\)/);
  assert.match(source, /\.limit\(HISTORY_LIMIT\)/);
});

test("checkout requires digital content consent", async () => {
  const source = await readFile(
    new URL("../api/create-checkout-session.js", import.meta.url),
    "utf8",
  );

  assert.match(source, /digitalContentConsent !== true/);
  assert.match(source, /digital_content_consent: "true"/);
  assert.match(source, /custom_text/);
});

test("public config exposes only safe checkout state", async () => {
  const previous = {
    mode: process.env.STRIPE_MODE,
    key: process.env.STRIPE_SECRET_KEY,
    price: process.env.STRIPE_PRICE_ID,
    webhook: process.env.STRIPE_WEBHOOK_SECRET,
  };

  process.env.STRIPE_MODE = "test";
  process.env.STRIPE_SECRET_KEY = "sk_test_example";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_example";
  delete process.env.STRIPE_PRICE_ID;

  try {
    const { response, result } = responseRecorder();
    await publicConfig({ method: "GET" }, response);

    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.body.creditPack, {
      credits: 5,
      amount: 999,
      currency: "EUR",
    });
    assert.equal(result.body.stripeMode, "test");
    assert.equal(result.body.checkoutReady, true);
    assert.doesNotMatch(JSON.stringify(result.body), /sk_test_|whsec_/);
  } finally {
    restoreEnvironment(previous);
  }
});

test("Stripe mode and secret key family must match", () => {
  const previous = {
    mode: process.env.STRIPE_MODE,
    key: process.env.STRIPE_SECRET_KEY,
    price: process.env.STRIPE_PRICE_ID,
    webhook: process.env.STRIPE_WEBHOOK_SECRET,
  };

  try {
    process.env.STRIPE_MODE = "live";
    process.env.STRIPE_SECRET_KEY = "sk_test_example";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_example";
    process.env.STRIPE_PRICE_ID = "price_example";

    assert.equal(getStripeMode(), "live");
    assert.equal(stripeCheckoutReady(), false);
    assert.throws(() => getStripeClient(), /ne correspond pas au mode live/);

    process.env.STRIPE_MODE = "test";
    process.env.STRIPE_SECRET_KEY = "sk_live_example";

    assert.equal(stripeCheckoutReady(), false);
    assert.throws(() => getStripeClient(), /ne correspond pas au mode test/);
  } finally {
    restoreEnvironment(previous);
  }
});

function restoreEnvironment(previous) {
  const entries = [
    ["STRIPE_MODE", previous.mode],
    ["STRIPE_SECRET_KEY", previous.key],
    ["STRIPE_PRICE_ID", previous.price],
    ["STRIPE_WEBHOOK_SECRET", previous.webhook],
  ];

  for (const [key, value] of entries) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
