# Babes Analyst (StripeCode Agent)

**Describe it. Run it. Make better business decisions.**

Babes Analyst is an AI agent for small shops. You ask a question about your sales in plain English. The agent writes Python code, runs it safely inside a CreateOS sandbox, fixes its own mistakes, and explains the answer in simple words.

It was built for the CreateOS x Stripe Projects online hackathon, on top of my shop, Babes & Babies.

- Shop and analyst page: https://babesandbabies-dcb39.web.app/analyst.html
- Shop code: https://github.com/sirmos/babesandbabies

## What it does

- Reads paid orders from Stripe (test mode), including which products were in each order
- Shows total sales, number of orders, average order and a table of products
- Answers questions like "which products sell best?" and "what happens to sales if I raise a price 10%?"
- Lets the owner try a price change with two sliders: the price change, and how much they expect sales to drop
- Shows the exact code the agent wrote and what the sandbox printed, so you can check the work

## How it works

1. A customer pays in the shop. Stripe records the order and the items.
2. The server pulls the orders from Stripe and puts them in a sandbox as a file.
3. An AI model writes a Python script for the question.
4. The script runs inside a CreateOS sandbox (a small virtual machine that is thrown away after each question).
5. If the script crashes, or says it found no data, the error goes back to the model and it tries again, up to 4 times.
6. The model explains the final numbers in short, simple English.

## Safe by design

- The sandbox only gets the order data. It never gets the Stripe key or any other secret.
- Stripe test mode only. The server refuses to start with a live key.
- Prices for checkout come from the server's product list, never from the browser.
- Public limits: one question at a time, and 40 questions an hour.
- If one AI model fails or runs out of free quota, the next one is tried (Groq: gpt-oss-120b, then gpt-oss-20b, then qwen).

## Stripe Projects and CreateOS

I started from an empty folder and used Stripe Projects (`stripe projects init`, then `stripe projects add createos/...`) to set up the CreateOS account and keys. The agent code uses the `@nodeops-createos/sandbox` package to create a sandbox, run commands and destroy it. The server is deployed on CreateOS.

## Run it yourself

You need Node.js 20 or newer.

```
npm install
```

Create a `.env` file:

```
GROQ_API_KEY=your_groq_key
STRIPE_SECRET_KEY=sk_test_your_test_key
CREATEOS_PLAN_API_KEY=your_createos_key
SITE_URL=https://babesandbabies-dcb39.web.app
```

Make some test orders in Stripe, then start the server:

```
node seed.mjs 150
npm start
```

Open http://localhost:8080. You can also ask from the command line:

```
node agent.mjs "which products sell best?"
```

## Files

- `agent.mjs` - the agent loop: get data, write code, run in sandbox, fix errors, explain
- `server.mjs` - the web server (summary, analyze, and Stripe checkout routes)
- `analyst.html` - the page customers and judges use
- `catalog.mjs` - the product list and prices
- `seed.mjs` - creates test orders in Stripe
- `check.mjs` - checks which keys are set and working (never prints them)

## Known limits

- CreateOS Sandbox is in alpha, so things may change.
- Stripe does not let you backdate test payments, so seeded orders all have today's date. Product questions and price tests work well. A cash flow forecast will say it is rough until there are more days of orders.
- A price test is a simple what-if using the numbers you give it. It is not a promise of what will happen.
- Everything here uses test data. No money moves.
