import "dotenv/config";

// Tries every CreateOS key in your .env against the sandbox API.
// Prints only the variable name and OK or FAILED. Never prints a key.
const base = process.env.CREATEOS_SANDBOX_BASE_URL || "https://api.sb.createos.sh";
const names = Object.keys(process.env).filter((n) => /^CREATEOS_.*API_KEY$/.test(n));

if (!names.length) console.log("No CREATEOS_*_API_KEY variables found in .env");

for (const name of names) {
  try {
    const res = await fetch(`${base}/v1/whoami`, { headers: { "X-Api-Key": process.env[name] } });
    console.log(`${name}: ${res.ok ? "OK" : "FAILED (" + res.status + ")"}`);
  } catch (e) {
    console.log(`${name}: ERROR ${e.message}`);
  }
}

console.log("GROQ_API_KEY:", process.env.GROQ_API_KEY ? "found" : "MISSING");
console.log("STRIPE_SECRET_KEY:", process.env.STRIPE_SECRET_KEY ? "found" : "missing (sample data will be used)");
