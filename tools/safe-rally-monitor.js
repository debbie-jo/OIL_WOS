const fs = require("fs");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");
const { createWorker } = require("tesseract.js");

const ROOT = path.resolve(__dirname, "..");
const SCREENSHOT_DIR = path.join(__dirname, "screenshots");
const RALLIES_FILE = path.join(ROOT, "rallies.json");
const CAPTURE_SCRIPT = path.join(__dirname, "capture-ldplayer.ps1");
const CROP_SCRIPT = path.join(__dirname, "crop-image.ps1");
const CONFIG_FILE = path.join(__dirname, "rally-config.json");
const ENV_FILE = path.join(ROOT, ".env");
const INTERVAL_MS = 1000;
const OCR_SOURCE = "ldplayer-safe-ocr";

const args = new Set(process.argv.slice(2));
const once = args.has("--once");
const publish = args.has("--publish");
const keepManual = args.has("--keep-manual");
const debug = args.has("--debug");
const imageArgIndex = process.argv.indexOf("--image");
const imagePath = imageArgIndex >= 0 ? path.resolve(process.argv[imageArgIndex + 1] || "") : "";

let worker;
let lastSignature = "";
let noBattleStreak = 0;

function readEnv() {
  const env = { ...process.env };
  if (!fs.existsSync(ENV_FILE)) return env;

  for (const line of fs.readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index < 0) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    env[key] = value;
  }
  return env;
}

function readConfig() {
  if (!fs.existsSync(CONFIG_FILE)) return { slotLeaders: [], defaultTarget: "Alliance Flag", timeRegions: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    return {
      slotLeaders: Array.isArray(parsed.slotLeaders) ? parsed.slotLeaders : [],
      defaultTarget: parsed.defaultTarget || "Alliance Flag",
      maxRallySeconds: Number(parsed.maxRallySeconds) || 600,
      timeCropScale: Number(parsed.timeCropScale) || 3,
      timeRegions: Array.isArray(parsed.timeRegions) ? parsed.timeRegions : []
    };
  } catch {
    return { slotLeaders: [], defaultTarget: "Alliance Flag", maxRallySeconds: 600, timeCropScale: 3, timeRegions: [] };
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function runCapture(outputFile) {
  execFileSync("powershell", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    CAPTURE_SCRIPT,
    "-OutFile",
    outputFile
  ], { stdio: "pipe" });
}

function runCrop(inputFile, outputFile, region, scale) {
  execFileSync("powershell", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    CROP_SCRIPT,
    "-InFile",
    inputFile,
    "-OutFile",
    outputFile,
    "-Left",
    String(region.left),
    "-Top",
    String(region.top),
    "-Width",
    String(region.width),
    "-Height",
    String(region.height),
    "-Scale",
    String(scale)
  ], { stdio: "pipe" });
}

function compactText(text) {
  return String(text)
    .replace(/[|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseDuration(value) {
  const raw = String(value);
  const colon = raw.match(/(\d{1,2})\s*[:\uFF1A]\s*(\d{2})\s*[:\uFF1A]\s*(\d{2})/);
  if (colon) return Number(colon[1]) * 3600 + Number(colon[2]) * 60 + Number(colon[3]);

  let digits = raw.replace(/\D/g, "");
  if (digits.length >= 7 && digits.startsWith("00")) digits = "00" + digits.slice(-4);
  if (digits.length >= 6) {
    digits = digits.slice(-6);
    return Number(digits.slice(0, 2)) * 3600 + Number(digits.slice(2, 4)) * 60 + Number(digits.slice(4, 6));
  }
  if (digits.length === 4) return Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4));
  return null;
}

function isoFromRemaining(seconds, detectedAt) {
  return new Date(detectedAt.getTime() + seconds * 1000).toISOString();
}

function buildDetectedRallies(times, clean, config, detectedAt) {
  const targets = extractTargets(clean, config);
  const leaders = extractLeaders(clean);

  return times.map((remainingSeconds, index) => {
    const ocrLeader = leaders[index] || leaders[leaders.length - 1] || "";
    const hintLeader = config.slotLeaders[index] || "";
    const leader = ocrLeader && /[\uAC00-\uD7A3]/.test(ocrLeader) ? ocrLeader : hintLeader || ocrLeader || `OCR Rally ${index + 1}`;
    const target = targets[index] || targets[0] || config.defaultTarget || "Alliance Flag";
    const endsAt = isoFromRemaining(remainingSeconds, detectedAt);
    return {
      id: `ocr-${leader}-${index}`.replace(/[^\[\]a-zA-Z0-9\uAC00-\uD7A3_-]/g, "-"),
      title: `${leader} rally`,
      target,
      leader,
      startsAt: null,
      endsAt,
      source: OCR_SOURCE,
      note: "LDPlayer safe OCR"
    };
  });
}

function cleanBracketName(value) {
  return String(value || "")
    .replace(/\s+/g, "")
    .replace(/[^\[\]a-zA-Z0-9\uAC00-\uD7A3_-]/g, "")
    .trim();
}

function extractTargets(clean, config) {
  const targets = [];
  const targetPattern = /\[[^\]\s]{2,12}\]\s*(?:\uC5F0\s*\uB9F9\s*)?\uAE43\s*\uBC1C/g;
  for (const match of clean.matchAll(targetPattern)) {
    const value = cleanBracketName(match[0].replace(/\uC5F0\s*\uB9F9/g, "\uC5F0\uB9F9").replace(/\uAE43\s*\uBC1C/g, "\uAE43\uBC1C"));
    if (value && !targets.includes(value)) targets.push(value);
  }
  if (!targets.length && /\bKDH\b/i.test(clean)) targets.push(config.defaultTarget);
  return targets;
}

function extractLeaders(clean) {
  const leaders = [];
  const directPattern = /\[[^\]\s]{2,12}\]\s*[\uAC00-\uD7A3a-zA-Z0-9_ -]{2,18}/g;
  for (const match of clean.matchAll(directPattern)) {
    const value = cleanBracketName(match[0]);
    if (!value) continue;
    if (/KDH/i.test(value)) continue;
    if (/[\uC5F0\uB9F9\uAE43\uBC1C\uBAA9\uD45C\uBC29\uC5B4]/.test(value) && /\uC5F0\uB9F9|\uAE43\uBC1C|\uBAA9\uD45C|\uBC29\uC5B4/.test(value)) continue;
    if (!leaders.includes(value)) leaders.push(value);
  }
  return leaders;
}

function parseRallies(text, detectedAt = new Date()) {
  const clean = compactText(text);
  const config = readConfig();
  const noBattlePattern = /\uD604\s*\uC7AC\s*\uC804\s*\uD22C\s*\uAC00\s*\uC5C6\s*\uC2B5\s*\uB2C8\s*\uB2E4/;
  const hasNoBattle = noBattlePattern.test(clean);

  const times = [];
  const timePattern = /\uC9D1\s*\uACB0\s*\uC911\s*[:\uFF1A]?\s*([0-9\s:\uFF1A]{4,14})/g;
  for (const match of clean.matchAll(timePattern)) {
    const remainingSeconds = parseDuration(match[1]);
    if (remainingSeconds !== null && remainingSeconds > 0 && remainingSeconds <= config.maxRallySeconds) {
      times.push(remainingSeconds);
    }
  }

  if (!times.length) {
    return { rallies: [], confident: hasNoBattle, reason: hasNoBattle ? "no-battle" : "ocr-unclear" };
  }

  const rallies = buildDetectedRallies(times, clean, config, detectedAt);

  return { rallies, confident: true, reason: "rallies" };
}

async function readTimeRegionDurations(screenshot, text, detectedAt) {
  const config = readConfig();
  if (!config.timeRegions.length) return [];

  const ocrWorker = await getWorker();
  const cropDir = path.join(SCREENSHOT_DIR, "time-crops");
  ensureDir(cropDir);

  const durations = [];
  for (let index = 0; index < config.timeRegions.length; index += 1) {
    const region = config.timeRegions[index];
    if (![region.left, region.top, region.width, region.height].every((value) => Number.isFinite(Number(value)))) continue;

    const cropFile = path.join(cropDir, `time-${index + 1}.png`);
    try {
      runCrop(screenshot, cropFile, region, config.timeCropScale);
      await ocrWorker.setParameters({
        tessedit_char_whitelist: "0123456789:",
        tessedit_pageseg_mode: "7"
      });
      let result;
      try {
        result = await ocrWorker.recognize(cropFile);
      } finally {
        await ocrWorker.setParameters({
          tessedit_char_whitelist: ""
        });
      }
      const remainingSeconds = parseDuration(result.data.text);
      if (debug) {
        fs.writeFileSync(path.join(cropDir, `time-${index + 1}.txt`), result.data.text, "utf8");
      }
      if (remainingSeconds !== null && remainingSeconds > 0 && remainingSeconds <= config.maxRallySeconds) {
        durations.push(remainingSeconds);
      }
    } catch (error) {
      if (debug) console.log(`time crop ${index + 1} failed: ${error.message}`);
    }
  }

  if (!durations.length) return [];
  return buildDetectedRallies(durations, compactText(text), config, detectedAt);
}

function readRalliesFile() {
  if (!fs.existsSync(RALLIES_FILE)) return [];
  const parsed = JSON.parse(fs.readFileSync(RALLIES_FILE, "utf8"));
  return Array.isArray(parsed) ? parsed : parsed.rallies || [];
}

function sameRally(a, b) {
  const sameLeader = a.leader === b.leader;
  const sameTarget = a.target === b.target;
  const aEnd = a.endsAt ? new Date(a.endsAt).getTime() : 0;
  const bEnd = b.endsAt ? new Date(b.endsAt).getTime() : 0;
  return sameLeader && sameTarget && Math.abs(aEnd - bEnd) < 20000;
}

function syncRallies(existing, detected) {
  const now = Date.now();
  const manual = keepManual
    ? existing.filter((rally) => rally.source !== OCR_SOURCE && (!rally.endsAt || new Date(rally.endsAt).getTime() > now))
    : [];

  const synced = [];
  for (const rally of detected) {
    const previous = existing.find((item) => item.source === OCR_SOURCE && sameRally(item, rally));
    synced.push(previous ? { ...rally, id: previous.id } : rally);
  }

  return manual.concat(synced).sort((a, b) => {
    return new Date(a.endsAt || 8640000000000000) - new Date(b.endsAt || 8640000000000000);
  });
}

function writeRalliesFile(rallies) {
  fs.writeFileSync(RALLIES_FILE, JSON.stringify({
    updatedAt: new Date().toISOString(),
    rallies
  }, null, 2) + "\n", "utf8");
}

function supabaseBaseUrl(env) {
  const raw = env.SUPABASE_URL || "";
  return raw.replace(/\/rest\/v1\/?$/, "").replace(/\/$/, "");
}

function toDbRow(rally) {
  return {
    id: rally.id,
    title: rally.title,
    target: rally.target,
    leader: rally.leader,
    starts_at: rally.startsAt,
    ends_at: rally.endsAt,
    source: rally.source,
    note: rally.note,
    updated_at: new Date().toISOString()
  };
}

async function syncSupabase(rallies) {
  const env = readEnv();
  const baseUrl = supabaseBaseUrl(env);
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !key) throw new Error("Missing Supabase service settings in .env");

  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json"
  };

  const deleteResponse = await fetch(`${baseUrl}/rest/v1/rallies?source=eq.${encodeURIComponent(OCR_SOURCE)}`, {
    method: "DELETE",
    headers
  });
  if (!deleteResponse.ok) throw new Error(`Supabase delete failed: ${deleteResponse.status} ${await deleteResponse.text()}`);

  if (!rallies.length) return;

  const insertResponse = await fetch(`${baseUrl}/rest/v1/rallies`, {
    method: "POST",
    headers: { ...headers, Prefer: "return=minimal" },
    body: JSON.stringify(rallies.map(toDbRow))
  });
  if (!insertResponse.ok) throw new Error(`Supabase insert failed: ${insertResponse.status} ${await insertResponse.text()}`);
}

function pushToGithub() {
  const status = spawnSync("git", ["status", "--short", "rallies.json"], { cwd: ROOT, encoding: "utf8" });
  if (!status.stdout.trim()) return;

  spawnSync("git", ["add", "rallies.json"], { cwd: ROOT, stdio: "inherit" });
  spawnSync("git", ["commit", "-m", "Sync rally status data"], { cwd: ROOT, stdio: "inherit" });
  spawnSync("git", ["-c", "http.sslBackend=openssl", "push", "origin", "master"], { cwd: ROOT, stdio: "inherit" });
}

async function getWorker() {
  if (worker) return worker;
  worker = await createWorker("eng+kor");
  return worker;
}

async function publishRallies(rallies) {
  try {
    await syncSupabase(rallies);
    console.log("Supabase synced.");
  } catch (error) {
    console.log(`Supabase sync failed: ${error.message}`);
    console.log("Falling back to GitHub push.");
    pushToGithub();
  }
}

async function scanOnce() {
  ensureDir(SCREENSHOT_DIR);
  const screenshot = imagePath || path.join(SCREENSHOT_DIR, `ldplayer-${Date.now()}.png`);
  if (!imagePath) runCapture(screenshot);
  if (!fs.existsSync(screenshot)) throw new Error(`Missing screenshot: ${screenshot}`);

  const ocrWorker = await getWorker();
  const result = await ocrWorker.recognize(screenshot);
  const detectedAt = new Date();
  if (debug) fs.writeFileSync(path.join(SCREENSHOT_DIR, "latest-ocr.txt"), result.data.text, "utf8");

  const regionRallies = await readTimeRegionDurations(screenshot, result.data.text, detectedAt);
  const parsed = regionRallies.length
    ? { rallies: regionRallies, confident: true, reason: "time-regions" }
    : parseRallies(result.data.text, detectedAt);
  if (!parsed.confident) {
    noBattleStreak = 0;
    console.log(`[${detectedAt.toLocaleTimeString()}] OCR unclear; keeping previous rally data`);
    return;
  }

  const detected = parsed.rallies;
  if (!detected.length && parsed.reason === "no-battle") {
    noBattleStreak += 1;
    if (noBattleStreak < 2) {
      console.log(`[${detectedAt.toLocaleTimeString()}] no battle seen once; waiting one more check before clearing`);
      return;
    }
  } else {
    noBattleStreak = 0;
  }

  const synced = syncRallies(readRalliesFile(), detected);
  const signature = JSON.stringify(synced.map((r) => [r.leader, r.target, r.endsAt, r.source]));

  if (signature === lastSignature) {
    console.log(`[${detectedAt.toLocaleTimeString()}] no change`);
    return;
  }
  lastSignature = signature;

  writeRalliesFile(synced);

  if (!detected.length) {
    console.log(`[${detectedAt.toLocaleTimeString()}] no visible rallies; OCR rallies cleared`);
  } else {
    console.log(`[${detectedAt.toLocaleTimeString()}] synced ${detected.length} visible rally/rallies`);
    detected.forEach((rally, index) => {
      console.log(`${index + 1}. ${rally.leader} / ${rally.target} / ends ${new Date(rally.endsAt).toLocaleTimeString()}`);
    });
  }

  if (publish) await publishRallies(synced);
}

async function main() {
  console.log("LDPlayer safe OCR sync started.");
  console.log("Keep the game on Alliance War > Rally tab.");
  console.log("No clicks or game actions are performed. Visible rally list is synced automatically.\n");

  if (once) {
    await scanOnce();
    if (worker) await worker.terminate();
    return;
  }

  while (true) {
    await scanOnce();
    await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
  }
}

main().catch(async (error) => {
  console.error("Error:", error.message);
  if (worker) await worker.terminate();
  process.exit(1);
});
