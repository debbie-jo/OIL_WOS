const fs = require("fs");
const path = require("path");

function readEnv() {
  const envPath = path.join(__dirname, "..", ".env");
  const env = {};
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index < 0) continue;
    env[trimmed.slice(0, index)] = trimmed.slice(index + 1);
  }
  return env;
}

async function main() {
  const env = readEnv();
  const base = env.SUPABASE_URL.replace(/\/rest\/v1\/?$/, "").replace(/\/$/, "");
  const url = `${base}/rest/v1/rallies?select=*&order=ends_at.asc`;
  const response = await fetch(url, {
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`
    }
  });
  const text = await response.text();
  console.log("Status:", response.status);
  console.log(text);
}

main().catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});
