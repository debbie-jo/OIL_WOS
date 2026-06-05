const fs = require("fs");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");
const { createWorker } = require("tesseract.js");

const ROOT = path.resolve(__dirname, "..");
const SCREENSHOT_DIR = path.join(__dirname, "screenshots");
const RALLIES_FILE = path.join(ROOT, "rallies.json");
const CAPTURE_SCRIPT = path.join(__dirname, "capture-ldplayer.ps1");
const CONFIG_FILE = path.join(__dirname, "rally-config.json");
const INTERVAL_MS = 1000;
const OCR_SOURCE = "ldplayer-safe-ocr";

const args = new Set(process.argv.slice(2));
const once = args.has("--once");
const publish = args.has("--publish");
const keepManual = args.has("--keep-manual");
const imageArgIndex = process.argv.indexOf("--image");
const imagePath = imageArgIndex >= 0 ? path.resolve(process.argv[imageArgIndex + 1] || "") : "";

let worker;
let lastSignature = "";

function readConfig() {
  if (!fs.existsSync(CONFIG_FILE)) return { slotLeaders: [], defaultTarget: "Alliance Flag" };
  try {
    const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    return {
      slotLeaders: Array.isArray(parsed.slotLeaders) ? parsed.slotLeaders : [],
      defaultTarget: parsed.defaultTarget || "Alliance Flag"
    };
  } catch {
    return { slotLeaders: [], defaultTarget: "Alliance Flag" };
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

function compactText(text) {
  return String(text)
    .replace(/[|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseDuration(value) {
  const raw = String(value);
  const colon = raw.match(/(\d{1,2})\s*[:：]\s*(\d{2})\s*[:：]\s*(\d{2})/);
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

function cleanBracketName(value) {
  return String(value || "")
    .replace(/\s+/g, "")
    .replace(/[^\[\]a-zA-Z0-9가-힣_-]/g, "")
    .trim();
}

function extractTargets(clean) {
  const targets = [];
  const targetPattern = /\[[^\]\s]{2,12}\]\s*(?:연\s*맹\s*)?깃\s*발/g;
  for (const match of clean.matchAll(targetPattern)) {
    const value = cleanBracketName(match[0].replace(/연\s*맹/g, "연맹").replace(/깃\s*발/g, "깃발"));
    if (value && !targets.includes(value)) targets.push(value);
  }
  if (!targets.length && /\bKDH\b/i.test(clean)) targets.push("[KDH]연맹깃발");
  return targets;
}

function extractLeaders(clean) {
  const leaders = [];

  const directPattern = /\[[^\]\s]{2,12}\]\s*[가-힣a-zA-Z0-9_ -]{2,18}/g;
  for (const match of clean.matchAll(directPattern)) {
    const value = cleanBracketName(match[0]);
    if (!value) continue;
    if (/KDH|연맹|깃발|목표|방어/i.test(value)) continue;
    if (!leaders.includes(value)) leaders.push(value);
  }

  if (!leaders.length) {
    const tagPattern = /\[\s*k\s*o\s*z\s*\]/ig;
    let idx = 1;
    for (const match of clean.matchAll(tagPattern)) {
      const value = `[koz]OCR집결장${idx++}`;
      if (!leaders.includes(value)) leaders.push(value);
    }
  }

  return leaders;
}

function parseRallies(text, detectedAt = new Date()) {
  const clean = compactText(text);
  const config = readConfig();
  if (/현재\s*전투가\s*없습니다/.test(clean)) return [];

  const times = [];
  const timePattern = /집\s*결\s*중\s*[:：]?\s*([0-9\s:：]{4,14})/g;
  for (const match of clean.matchAll(timePattern)) {
    const remainingSeconds = parseDuration(match[1]);
    if (remainingSeconds !== null && remainingSeconds > 0) times.push(remainingSeconds);
  }
  if (!times.length) return [];

  const targets = extractTargets(clean);
  const leaders = extractLeaders(clean);

  return times.map((remainingSeconds, index) => {
    const ocrLeader = leaders[index] || leaders[leaders.length - 1] || "";
    const hintLeader = config.slotLeaders[index] || "";
    const leader = ocrLeader && /[가-힣]/.test(ocrLeader) ? ocrLeader : hintLeader || ocrLeader || `OCR Rally ${index + 1}`;
    const target = targets[index] || targets[0] || config.defaultTarget || "Alliance Flag";
    const endsAt = isoFromRemaining(remainingSeconds, detectedAt);
    return {
      id: `ocr-${leader}-${index}`.replace(/[^a-zA-Z0-9가-힣_-]/g, "-"),
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

async function scanOnce() {
  ensureDir(SCREENSHOT_DIR);
  const screenshot = imagePath || path.join(SCREENSHOT_DIR, `ldplayer-${Date.now()}.png`);
  if (!imagePath) runCapture(screenshot);
  if (!fs.existsSync(screenshot)) throw new Error(`Missing screenshot: ${screenshot}`);

  const ocrWorker = await getWorker();
  const result = await ocrWorker.recognize(screenshot);
  const detectedAt = new Date();
  const detected = parseRallies(result.data.text, detectedAt);
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

  if (publish) pushToGithub();
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
