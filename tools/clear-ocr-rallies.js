const fs = require("fs");
const path = require("path");

const ENV_FILE = path.join(__dirname, "..", ".env");
const OCR_SOURCE = "ldplayer-safe-ocr";

function readEnv() {
  const env = {};
  for (const line of fs.readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) {
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
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const response = await fetch(`${base}/rest/v1/rallies?source=eq.${encodeURIComponent(OCR_SOURCE)}`, {
    method: "DELETE",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`
    }
  });
  const text = await response.text();
  console.log("Status:", response.status);
  if (text) console.log(text);
}

main().catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});
