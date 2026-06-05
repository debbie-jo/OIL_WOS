const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { execFileSync, spawnSync } = require("child_process");
const { createWorker } = require("tesseract.js");

const ROOT = path.resolve(__dirname, "..");
const SCREENSHOT_DIR = path.join(__dirname, "screenshots");
const RALLIES_FILE = path.join(ROOT, "rallies.json");
const CAPTURE_SCRIPT = path.join(__dirname, "capture-ldplayer.ps1");
const INTERVAL_MS = 1000;

const args = new Set(process.argv.slice(2));
const once = args.has("--once");
const publish = args.has("--publish");
const imageArgIndex = process.argv.indexOf("--image");
const imagePath = imageArgIndex >= 0 ? path.resolve(process.argv[imageArgIndex + 1] || "") : "";

let lastSignature = "";
let worker;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function runPowerShell(script, outputFile) {
  execFileSync("powershell", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    script,
    "-OutFile",
    outputFile
  ], { stdio: "pipe" });
}

function parseDuration(value) {
  const raw = String(value);
  const match = raw.match(/(\d{1,2})\s*[:：]\s*(\d{2})\s*[:：]\s*(\d{2})/);
  if (match) return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);

  let digits = raw.replace(/\D/g, "");
  if (digits.length === 7 && digits.startsWith("00")) {
    digits = digits.slice(0, 2) + digits.slice(-4);
  }
  if (digits.length === 6) {
    return Number(digits.slice(0, 2)) * 3600 + Number(digits.slice(2, 4)) * 60 + Number(digits.slice(4, 6));
  }
  if (digits.length === 4) {
    return Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4));
  }
  return null;
}

function isoFromRemaining(seconds, detectedAt = new Date()) {
  return new Date(detectedAt.getTime() + seconds * 1000).toISOString();
}

function compactText(text) {
  return text
    .replace(/[|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseRallies(text, detectedAt = new Date()) {
  const clean = compactText(text);
  if (/현재\s*전투가\s*없습니다/.test(clean)) return [];

  const timeMatches = [...clean.matchAll(/집\s*결\s*중\s*[:：]?\s*([0-9\s:：]{4,12})/g)];
  if (!timeMatches.length) return [];

  const targetMatches = [...clean.matchAll(/\[[^\]\s]{2,12}\]\s*연맹\s*깃발/g)].map((m) => m[0].replace(/\s+/g, ""));
  const leaderMatches = [...clean.matchAll(/\[[^\]\s]{2,12}\]\s*[^\s\[\]]{2,16}(?:팀장|입장|대장|장)?/g)]
    .map((m) => m[0].replace(/\s+/g, ""))
    .filter((value) => !/연맹깃발/.test(value) && !/KDH|목표|방어/.test(value));

  return timeMatches.map((match, index) => {
    const remainingSeconds = parseDuration(match[1]);
    if (remainingSeconds === null) return null;
    const leader = leaderMatches[index] || leaderMatches[leaderMatches.length - 1] || `OCR 집결장 ${index + 1}`;
    const target = targetMatches[index] || targetMatches[0] || "연맹 깃발";
    return {
      id: `ocr-${leader}-${isoFromRemaining(remainingSeconds, detectedAt)}`.replace(/[^a-zA-Z0-9가-힣_-]/g, "-"),
      title: `${leader} 집결`,
      target,
      leader,
      startsAt: null,
      endsAt: isoFromRemaining(remainingSeconds, detectedAt),
      note: "LD플레이어 안전모드 OCR 감지"
    };
  }).filter(Boolean);
}

function mergeRallies(existing, detected) {
  const now = Date.now();
  const activeExisting = existing.filter((rally) => {
    if (!rally.endsAt) return true;
    return new Date(rally.endsAt).getTime() > now;
  });

  for (const rally of detected) {
    const duplicate = activeExisting.some((item) => {
      const sameLeader = item.leader === rally.leader;
      const sameTarget = item.target === rally.target;
      const itemEnd = item.endsAt ? new Date(item.endsAt).getTime() : 0;
      const rallyEnd = rally.endsAt ? new Date(rally.endsAt).getTime() : 0;
      return sameLeader && sameTarget && Math.abs(itemEnd - rallyEnd) < 15000;
    });
    if (!duplicate) activeExisting.push(rally);
  }

  activeExisting.sort((a, b) => new Date(a.endsAt || 8640000000000000) - new Date(b.endsAt || 8640000000000000));
  return activeExisting;
}

function readRalliesFile() {
  if (!fs.existsSync(RALLIES_FILE)) return [];
  const parsed = JSON.parse(fs.readFileSync(RALLIES_FILE, "utf8"));
  return Array.isArray(parsed) ? parsed : parsed.rallies || [];
}

function writeRalliesFile(rallies) {
  fs.writeFileSync(RALLIES_FILE, JSON.stringify({
    updatedAt: new Date().toISOString(),
    rallies
  }, null, 2) + "\n", "utf8");
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

function pushToGithub() {
  const status = spawnSync("git", ["status", "--short", "rallies.json"], { cwd: ROOT, encoding: "utf8" });
  if (!status.stdout.trim()) return;
  spawnSync("git", ["add", "rallies.json"], { cwd: ROOT, stdio: "inherit" });
  spawnSync("git", ["commit", "-m", "Update rally status data"], { cwd: ROOT, stdio: "inherit" });
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
  if (!imagePath) {
    runPowerShell(CAPTURE_SCRIPT, screenshot);
  } else if (!fs.existsSync(screenshot)) {
    throw new Error(`캡처 파일이 없습니다: ${screenshot}`);
  }

  const ocrWorker = await getWorker();
  const result = await ocrWorker.recognize(screenshot);
  const detectedAt = new Date();
  const rallies = parseRallies(result.data.text, detectedAt);
  const signature = JSON.stringify(rallies.map((r) => [r.leader, r.target, r.endsAt]));

  if (!rallies.length) {
    console.log(`[${detectedAt.toLocaleTimeString()}] 집결 없음 또는 인식 실패`);
    return;
  }

  if (signature === lastSignature) {
    console.log(`[${detectedAt.toLocaleTimeString()}] 같은 집결 감지됨, 중복 등록 안 함`);
    return;
  }
  lastSignature = signature;

  console.log("\n감지된 집결 후보:");
  rallies.forEach((rally, index) => {
    const endsAt = new Date(rally.endsAt);
    console.log(`${index + 1}. ${rally.leader} / ${rally.target} / 종료 예정 ${endsAt.toLocaleTimeString()}`);
  });

  const answer = await ask("사이트 집결 현황에 반영할까요? (y/N) ");
  if (answer !== "y" && answer !== "yes") {
    console.log("취소했습니다.");
    return;
  }

  const merged = mergeRallies(readRalliesFile(), rallies);
  writeRalliesFile(merged);
  console.log("rallies.json을 갱신했습니다.");

  if (publish) {
    pushToGithub();
  } else {
    console.log("GitHub 반영은 아래 명령으로 할 수 있습니다:");
    console.log("git -c http.sslBackend=openssl push origin master");
  }
}

async function main() {
  console.log("LD플레이어 안전모드 OCR 감시를 시작합니다.");
  console.log("게임은 연맹 전쟁 > 집결 탭을 열어둔 상태여야 합니다.");
  console.log("게임 클릭/참여는 하지 않고, 화면 읽기와 확인 후 데이터 갱신만 합니다.\n");

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
  console.error("오류:", error.message);
  if (worker) await worker.terminate();
  process.exit(1);
});
