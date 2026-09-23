import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import checkoutStatus from "../api/checkout-status.js";
import createCheckoutSession from "../api/create-checkout-session.js";
import generate from "../api/generate.js";
import history from "../api/history.js";
import me from "../api/me.js";
import status from "../api/status.js";
import stripeWebhook from "../api/stripe-webhook.js";

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
