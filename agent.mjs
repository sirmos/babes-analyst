import "dotenv/config";
import { createClient } from "@nodeops-createos/sandbox";
import Stripe from "stripe";
import { pathToFileURL } from "node:url";
import { CATALOG } from "./catalog.mjs";

// ---- settings ----
// Models are tried in order. If one fails or hits a limit, the next one is used.
const MODELS = ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.8-27b"];
const MAX_TRIES = 4;
const CREATEOS_KEY_VAR = "CREATEOS_PLAN_API_KEY";

// ---- Groq helper with fallback ----
async function chat(system, messages, max_tokens = 4000, log = console.log) {
  const all = system ? [{ role: "system", content: system }, ...messages] : messages;
  for (const model of MODELS) {
    try {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
        body: JSON.stringify({ model, max_tokens, messages: all }),
      });
      const json = await res.json();
      if (!res.ok) {
        log(`[${model}] failed (${res.status}), trying the next model...`);
        continue;
      }
      let text = (json.choices?.[0]?.message?.content || "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
      if (!text) {
        log(`[${model}] gave an empty answer, trying the next model...`);
        continue;
      }
      return text;
    } catch (e) {
      log(`[${model}] error: ${e.message}, trying the next model...`);
    }
  }
  throw new Error("All models failed");
}

// ---- Sales data (Stripe test payments, or sample data if there is no key) ----
export async function getSales(log = console.log) {
  if (!process.env.STRIPE_SECRET_KEY) {
    log("No STRIPE_SECRET_KEY found, using sample data");
    return sampleSales();
  }
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const rows = [];
  for await (const pi of stripe.paymentIntents.list({ limit: 100 })) {
    if (pi.status !== "succeeded") continue;
    let items = [];
    try { items = JSON.parse(pi.metadata?.items || "[]"); } catch {}
    rows.push({
      date: new Date(pi.created * 1000).toISOString().slice(0, 10),
      amount: (pi.amount_received ?? pi.amount) / 100,
      currency: pi.currency,
      status: pi.status,
      items,
    });
    if (rows.length >= 500) break;
  }
  if (!rows.length) {
    log("Stripe has no payments yet, using sample data. Run: node seed.mjs");
    return sampleSales();
  }
  return rows;
}

function sampleSales() {
  const rows = [];
  for (let i = 120; i > 0; i--) {
    const date = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    const orders = 1 + Math.floor(Math.random() * 3);
    for (let j = 0; j < orders; j++) {
      const items = [];
      for (let k = 0; k < 1 + Math.floor(Math.random() * 2); k++) {
        const p = CATALOG[Math.floor(Math.random() * CATALOG.length)];
        items.push([p.name, 1 + Math.floor(Math.random() * 2), p.price]);
      }
      const amount = items.reduce((s, [, q, p]) => s + q * p, 0);
      rows.push({ date, amount, currency: "usd", status: "succeeded", items });
    }
  }
  return rows;
}

// ---- Quick numbers for the dashboard (no model needed) ----
export function summarize(sales) {
  const revenue = sales.reduce((s, r) => s + r.amount, 0);
  const products = {};
  for (const r of sales) {
    for (const [name, qty, price] of r.items || []) {
      products[name] ||= { name, units: 0, revenue: 0 };
      products[name].units += qty;
      products[name].revenue += qty * price;
    }
  }
  return {
    revenue: Math.round(revenue * 100) / 100,
    orders: sales.length,
    avgOrder: sales.length ? Math.round((revenue / sales.length) * 100) / 100 : 0,
    products: Object.values(products).sort((a, b) => b.revenue - a.revenue),
  };
}

function describeData(sales) {
  const dates = sales.map((r) => r.date).sort();
  const days = Math.round((new Date(dates.at(-1)) - new Date(dates[0])) / 86400000) + 1;
  return `The file /work/sales.json is a JSON list with ${sales.length} rows. Each row is one paid customer order.
Every row has exactly these fields:
- date (string YYYY-MM-DD)
- amount (number, money received for the order)
- currency (string)
- status (string, always "succeeded")
- items (list of [product name, quantity, unit price]; amount equals the sum of quantity times unit price)
Dates run from ${dates[0]} to ${dates.at(-1)} (${days} days).${days < 14 ? " The history is short, so say clearly that any forecast is rough." : ""}
Sample rows: ${JSON.stringify(sales.slice(0, 3))}`;
}

function systemPrompt(sales) {
  return `You write Python 3 scripts for business analysis of a small shop.
${describeData(sales)}
Rules:
- Use only the Python standard library.
- Read the file with json.load(open("/work/sales.json")). Use only the fields listed above.
- Print clear numbers with print(): totals, averages, and whatever the goal asks for. For product questions, use the items field.
- Never print messages like "no data found". The data exists.
- Reply with ONE python code block and nothing else.`;
}

async function askForCode(system, messages, log) {
  const text = await chat(system, messages, 4000, log);
  const match = text.match(/```(?:python)?\n([\s\S]*?)```/);
  return { raw: text, code: match ? match[1] : text };
}

// ---- Run code in the CreateOS sandbox ----
async function runPython(sandbox, code) {
  const b64 = Buffer.from(code).toString("base64");
  await sandbox.runCommand("sh", ["-c", `echo ${b64} | base64 -d > /work/main.py`]);
  const out = await sandbox.runCommand("python3", ["/work/main.py"]);
  const r = out.result;
  const exit = r.exitCode ?? r.exit_code ?? 0;
  const stdout = r.stdout || "";
  const stderr = r.stderr || "";
  const saysNoData = /\b(no (cash|sales|data|records|rows|payments)|not found|could not|cannot|unable to)\b/i.test(stdout);
  const tooShort = stdout.trim().length < 15;
  const ok = exit === 0 && !saysNoData && !tooShort;
  const problem = !ok && exit === 0 ? "The script ran but its output says it found no data, or printed almost nothing." : stderr;
  return { ok, stdout, stderr: problem };
}

// ---- The agent loop ----
export async function runAgent(goal, log = console.log) {
  const sales = await getSales(log);
  log(`Loaded ${sales.length} orders`);

  const client = createClient({ apiKey: process.env[CREATEOS_KEY_VAR] });
  const sandbox = await client.createSandbox({ shape: "s-1vcpu-1gb", rootfs: "devbox:1" });

  try {
    const data64 = Buffer.from(JSON.stringify(sales)).toString("base64");
    await sandbox.runCommand("sh", ["-c", `mkdir -p /work && echo ${data64} | base64 -d > /work/sales.json`]);

    const system = systemPrompt(sales);
    const messages = [{ role: "user", content: `Goal: ${goal}` }];
    let last, code = "", tries = 0;

    for (let i = 1; i <= MAX_TRIES; i++) {
      tries = i;
      const res = await askForCode(system, messages, log);
      code = res.code;
      log(`\n--- Try ${i}: code written by the agent ---\n${code}`);
      last = await runPython(sandbox, code);
      log(`--- Try ${i}: output from the sandbox ---\n${last.stdout || "(nothing)"}`);
      if (last.ok) break;
      log("Problem found, asking the agent to fix it...\n" + last.stderr);
      messages.push({ role: "assistant", content: res.raw });
      messages.push({
        role: "user",
        content: `That did not work. Problem:\n${last.stderr}\nOutput was:\n${last.stdout}\nFix the script. The data has ${sales.length} rows with fields date, amount, currency, status, items.`,
      });
    }

    if (!last.ok) return { ok: false, error: "The agent could not get working code after several tries.", code, output: last.stdout, tries };

    const answer = await chat(null, [{
      role: "user",
      content: `A small shop owner asked: "${goal}"
We ran an analysis on their order data and got this output:

${last.stdout}

Explain the result in very simple English. Say what the numbers mean, then give 2 or 3 clear actions. Keep it short. Do not mention scripts, code or errors. Do not use long dashes. Use - if you need a dash.`,
    }], 1500, log);

    return { ok: true, answer, code, output: last.stdout, tries };
  } finally {
    await sandbox.destroy(); // a sandbox you forget to destroy keeps billing
  }
}

// ---- Command line use: node agent.mjs "your goal" ----
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const goal = process.argv.slice(2).join(" ") || "Show best selling products and forecast next month";
  runAgent(goal)
    .then((r) => console.log(r.ok ? "\n=== Answer ===\n" + r.answer : "\nFailed: " + r.error))
    .catch((e) => { console.error("Failed:", e.message || e); process.exit(1); });
}
