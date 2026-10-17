import "dotenv/config";
import http from "node:http";
import { readFile } from "node:fs/promises";
import Stripe from "stripe";
import { runAgent, getSales, summarize } from "./agent.mjs";
import { CATALOG } from "./catalog.mjs";

const key = process.env.STRIPE_SECRET_KEY || "";
if (key && !key.startsWith("sk_test_") && !key.startsWith("rk_test_")) {
  console.error("STRIPE_SECRET_KEY is not a test key. This project only runs in test mode. Stopping.");
  process.exit(1);
}
const stripe = key ? new Stripe(key) : null;

const PORT = process.env.PORT || 8080;
const SITE_URL = process.env.SITE_URL || "https://babesandbabies-dcb39.web.app";
const ORIGIN = process.env.ALLOWED_ORIGIN || "*";

// Simple guards, because this page is public and each analysis uses a sandbox and a model
let busy = false;
const hits = [];
function allowed() {
  const now = Date.now();
  while (hits.length && now - hits[0] > 3600000) hits.shift();
  if (hits.length >= 40) return false;
  hits.push(now);
  return true;
}

function send(res, status, body, type = "application/json") {
  res.writeHead(status, {
    "Content-Type": type,
    "Access-Control-Allow-Origin": ORIGIN,
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  });
  res.end(type === "application/json" ? JSON.stringify(body) : body);
}

async function readJson(req) {
  let data = "";
  for await (const chunk of req) {
    data += chunk;
    if (data.length > 20000) throw new Error("Request too large");
  }
  return data ? JSON.parse(data) : {};
}

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (req.method === "OPTIONS") return send(res, 204, "", "text/plain");

    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/analyst.html")) {
      return send(res, 200, await readFile(new URL("./analyst.html", import.meta.url)), "text/html");
    }

    if (req.method === "GET" && url.pathname === "/api/summary") {
      const sales = await getSales(() => {});
      return send(res, 200, { ...summarize(sales), catalog: CATALOG, usingStripe: Boolean(stripe) });
    }

    if (req.method === "POST" && url.pathname === "/api/analyze") {
      const { goal } = await readJson(req);
      const clean = String(goal || "").trim().slice(0, 400);
      if (!clean) return send(res, 400, { error: "Please type or pick a goal." });
      if (busy) return send(res, 429, { error: "The agent is busy with another question. Try again in a moment." });
      if (!allowed()) return send(res, 429, { error: "Too many questions this hour. Please try later." });
      busy = true;
      try {
        return send(res, 200, await runAgent(clean));
      } finally {
        busy = false;
      }
    }

    if (req.method === "POST" && url.pathname === "/api/checkout") {
      if (!stripe) return send(res, 500, { error: "Stripe is not set up on the server." });
      const { items } = await readJson(req);
      if (!Array.isArray(items) || !items.length) return send(res, 400, { error: "Your cart is empty." });
      const lines = [];
      for (const it of items) {
        const product = CATALOG.find((p) => p.name === it.name);
        const qty = Number(it.qty);
        if (!product || !Number.isInteger(qty) || qty < 1 || qty > 20) return send(res, 400, { error: `Cannot buy "${it.name}".` });
        lines.push({ name: product.name, qty, price: product.price });
      }
      const meta = JSON.stringify(lines.map((l) => [l.name, l.qty, l.price]));
      if (meta.length > 480) return send(res, 400, { error: "Too many different items in one order." });
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        line_items: lines.map((l) => ({
          quantity: l.qty,
          price_data: { currency: "usd", unit_amount: Math.round(l.price * 100), product_data: { name: l.name } },
        })),
        payment_intent_data: { metadata: { items: meta }, description: "Babes & Babies test order" },
        success_url: `${SITE_URL}/?paid=1`,
        cancel_url: `${SITE_URL}/?cancelled=1`,
      });
      return send(res, 200, { url: session.url });
    }

    send(res, 404, { error: "Not found" });
  } catch (e) {
    console.error(e);
    send(res, 500, { error: e.message || "Something went wrong" });
  }
}).listen(PORT, () => console.log(`Babes Analyst running on port ${PORT}`));
