import "dotenv/config";
import Stripe from "stripe";
import { CATALOG } from "./catalog.mjs";

const key = process.env.STRIPE_SECRET_KEY || "";
if (!key.startsWith("sk_test_") && !key.startsWith("rk_test_")) {
  console.error("STRIPE_SECRET_KEY must be a TEST key (starts with sk_test_). Stopping.");
  process.exit(1);
}
const stripe = new Stripe(key);
const N = Number(process.argv[2]) || 150;

// Popular products get picked more often, so the data has best sellers and slow sellers
const weights = CATALOG.map((_, i) => 1 / Math.pow(i + 1, 0.8));
const total = weights.reduce((a, b) => a + b, 0);
function pick() {
  let r = Math.random() * total;
  for (let i = 0; i < CATALOG.length; i++) {
    r -= weights[i];
    if (r <= 0) return CATALOG[i];
  }
  return CATALOG[0];
}

for (let n = 1; n <= N; n++) {
  const lines = new Map();
  const count = 1 + Math.floor(Math.random() * 3);
  for (let i = 0; i < count; i++) {
    const p = pick();
    lines.set(p.name, { name: p.name, qty: (lines.get(p.name)?.qty || 0) + 1 + Math.floor(Math.random() * 2), price: p.price });
  }
  const items = [...lines.values()].map((l) => [l.name, l.qty, l.price]);
  const amount = Math.round(items.reduce((s, [, q, p]) => s + q * p, 0) * 100);
  await stripe.paymentIntents.create({
    amount,
    currency: "usd",
    payment_method: "pm_card_visa",
    confirm: true,
    automatic_payment_methods: { enabled: true, allow_redirects: "never" },
    description: "Babes & Babies test order",
    metadata: { items: JSON.stringify(items) },
  });
  if (n % 10 === 0) console.log(`Created ${n} of ${N} test orders`);
}
console.log("Done. Look at Payments in your Stripe test dashboard.");
