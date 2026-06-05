const RALLY_SOURCE = "rallies.json";
const REFRESH_INTERVAL_MS = 60 * 1000;

const listEl = document.querySelector("[data-rally-list]");
const emptyEl = document.querySelector("[data-empty-state]");
const loadStatusEl = document.querySelector("[data-load-status]");
const statusDotEl = document.querySelector("[data-status-dot]");
const lastUpdatedEl = document.querySelector("[data-last-updated]");
const refreshButton = document.querySelector("[data-refresh]");
const filterButtons = Array.from(document.querySelectorAll("[data-filter]"));

let rallies = [];
let activeFilter = "active";

function parseDate(value) {
  if (!value) return null;

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getRallyState(rally, now = new Date()) {
  const startsAt = parseDate(rally.startsAt);
  const endsAt = parseDate(rally.endsAt);

  if (endsAt && endsAt <= now) {
    return { label: "종료됨", status: "ended", startsAt, endsAt, remainingMs: 0 };
  }

  const targetDate = endsAt || startsAt;
  const remainingMs = targetDate ? Math.max(0, targetDate - now) : null;
  const status = remainingMs !== null && remainingMs <= 10 * 60 * 1000 ? "ending" : "active";
  const label = remainingMs === null ? "시간 미정" : formatRemaining(remainingMs);

  return { label, status, startsAt, endsAt, remainingMs };
}

function formatRemaining(ms) {
  const totalMinutes = Math.ceil(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0) {
    return `${hours}시간 ${minutes}분`;
  }

  return `${minutes}분`;
}

function formatDate(date) {
  if (!date) return "시간 미정";

  return new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function normalizeRallies(data) {
  const source = Array.isArray(data) ? data : data.rallies;
  if (!Array.isArray(source)) return [];

  return source
    .filter((rally) => rally && rally.title)
    .map((rally, index) => ({
      id: rally.id || `rally-${index}`,
      title: rally.title,
      target: rally.target || "대상 미정",
      leader: rally.leader || "집결장 미정",
      startsAt: rally.startsAt || null,
      endsAt: rally.endsAt || null,
      note: rally.note || ""
    }));
}

function getVisibleRallies() {
  const now = new Date();
  return rallies
    .map((rally) => ({ rally, state: getRallyState(rally, now) }))
    .filter(({ state }) => activeFilter === "all" || state.status !== "ended")
    .sort((a, b) => {
      const aDate = a.state.endsAt || a.state.startsAt || new Date(8640000000000000);
      const bDate = b.state.endsAt || b.state.startsAt || new Date(8640000000000000);
      return aDate - bDate;
    });
}

function render() {
  const visibleRallies = getVisibleRallies();
  listEl.innerHTML = "";
  emptyEl.hidden = visibleRallies.length > 0;

  visibleRallies.forEach(({ rally, state }) => {
    const card = document.createElement("article");
    card.className = `rally-card ${state.status === "ended" ? "is-ended" : ""}`;

    const timeClass = state.status === "ended"
      ? "is-ended"
      : state.status === "ending"
        ? "is-ending"
        : "";

    card.innerHTML = `
      <div>
        <div class="rally-title">
          <strong>${escapeHtml(rally.title)}</strong>
          <span class="badge">${escapeHtml(rally.target)}</span>
        </div>
        <div class="rally-meta">
          <span>시작 ${formatDate(state.startsAt)}</span>
          <span>종료 ${formatDate(state.endsAt)}</span>
          <span>집결장 ${escapeHtml(rally.leader)}</span>
        </div>
        ${rally.note ? `<p class="rally-note">${escapeHtml(rally.note)}</p>` : ""}
      </div>
      <div class="time-box ${timeClass}">
        <strong>${state.label}</strong>
        <span>${state.status === "ended" ? "만료" : "남음"}</span>
      </div>
    `;

    listEl.appendChild(card);
  });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function loadRallies() {
  loadStatusEl.textContent = "집결 데이터를 불러오는 중";
  statusDotEl.classList.remove("is-ready");

  try {
    const response = await fetch(`${RALLY_SOURCE}?t=${Date.now()}`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    rallies = normalizeRallies(data);
    loadStatusEl.textContent = "집결 데이터 연결됨";
    statusDotEl.classList.add("is-ready");
    lastUpdatedEl.textContent = `마지막 업데이트 ${formatDate(new Date())}`;
    render();
  } catch (error) {
    loadStatusEl.textContent = "집결 데이터를 불러오지 못했습니다";
    statusDotEl.classList.remove("is-ready");
    lastUpdatedEl.textContent = "업데이트 실패";
    rallies = [];
    render();
  }
}

filterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    activeFilter = button.dataset.filter;
    filterButtons.forEach((item) => item.classList.toggle("is-active", item === button));
    render();
  });
});

refreshButton.addEventListener("click", loadRallies);

loadRallies();
setInterval(() => {
  render();
  loadRallies();
}, REFRESH_INTERVAL_MS);
