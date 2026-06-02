(function () {
  const STORAGE_KEY = "wos-defense-fuel-v2";

  const els = {
    utcClock: document.getElementById("utcClock"),
    rallyBody: document.getElementById("rallyBody"),
    defenderBody: document.getElementById("defenderBody"),
    addRallyBtn: document.getElementById("addRallyBtn"),
    addDefenderBtn: document.getElementById("addDefenderBtn"),
    bulkRally: document.getElementById("bulkRally"),
    bulkMarch: document.getElementById("bulkMarch"),
    applySelectedBtn: document.getElementById("applySelectedBtn"),
    selectAll: document.getElementById("selectAll"),
    bulkPasteBtn: document.getElementById("bulkPasteBtn"),
    bulkDialog: document.getElementById("bulkDialog"),
    bulkText: document.getElementById("bulkText"),
    importBulkBtn: document.getElementById("importBulkBtn"),
    copyBtn: document.getElementById("copyBtn"),
    resetBtn: document.getElementById("resetBtn"),
    toast: document.getElementById("toast"),
  };

  const state = loadState();

  function defaultState() {
    const now = Date.now();
    return {
      rallies: Array.from({ length: 5 }, (_, index) => {
        const rally = {
          id: crypto.randomUUID(),
          name: `집결장 ${index + 1}`,
          rallyLeft: "05:00",
          enemyMarch: 40 + index,
          arrivalAt: null,
        };
        rally.arrivalAt = now + rallyInputSeconds(rally) * 1000;
        return rally;
      }),
      defenders: [
        { id: crypto.randomUUID(), name: "", march: 25, rallyId: null, selected: false },
        { id: crypto.randomUUID(), name: "", march: 35, rallyId: null, selected: false },
        { id: crypto.randomUUID(), name: "", march: 45, rallyId: null, selected: false },
      ],
    };
  }

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      const next = saved && Array.isArray(saved.rallies) && Array.isArray(saved.defenders) ? saved : defaultState();
      normalizeState(next);
      return next;
    } catch (_error) {
      const next = defaultState();
      normalizeState(next);
      return next;
    }
  }

  function normalizeState(next) {
    if (next.rallies.length < 5) {
      const start = next.rallies.length;
      for (let i = start; i < 5; i += 1) {
        next.rallies.push({
          id: crypto.randomUUID(),
          name: `집결장 ${i + 1}`,
          rallyLeft: "05:00",
          enemyMarch: 40,
          arrivalAt: Date.now() + 340000,
        });
      }
    }

    next.rallies.forEach((rally, index) => {
      rally.name = rally.name || `집결장 ${index + 1}`;
      rally.rallyLeft = normalizeTimeText(rally.rallyLeft || "05:00");
      rally.enemyMarch = Number(rally.enemyMarch || 0);
      if (!Number.isFinite(Number(rally.arrivalAt))) {
        rally.arrivalAt = Date.now() + rallyInputSeconds(rally) * 1000;
      }
    });

    next.defenders.forEach((defender) => {
      if (!defender.rallyId || !next.rallies.some((rally) => rally.id === defender.rallyId)) {
        defender.rallyId = next.rallies[0].id;
      }
      defender.march = Number(defender.march || 0);
      defender.selected = Boolean(defender.selected);
    });
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function parseTimeToSeconds(value) {
    const text = String(value || "").trim();
    if (!text) return 0;

    if (text.includes(":")) {
      const parts = text.split(":").map((part) => Number(part.trim()));
      if (parts.some((part) => Number.isNaN(part))) return 0;
      if (parts.length === 2) return Math.max(0, parts[0] * 60 + parts[1]);
      if (parts.length === 3) return Math.max(0, parts[0] * 3600 + parts[1] * 60 + parts[2]);
    }

    if (/^\d{3,4}$/.test(text)) {
      const padded = text.padStart(4, "0");
      return Number(padded.slice(0, -2)) * 60 + Number(padded.slice(-2));
    }

    const seconds = Number(text);
    return Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  }

  function normalizeTimeText(value) {
    return formatSeconds(parseTimeToSeconds(value));
  }

  function formatSeconds(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return "지남";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  function rallyInputSeconds(rally) {
    return parseTimeToSeconds(rally.rallyLeft) + Number(rally.enemyMarch || 0);
  }

  function rallyRemainingSeconds(rally) {
    return Math.ceil((Number(rally.arrivalAt || 0) - Date.now()) / 1000);
  }

  function defenderLaunchSeconds(defender) {
    const rally = state.rallies.find((item) => item.id === defender.rallyId) || state.rallies[0];
    return rallyRemainingSeconds(rally) - Number(defender.march || 0);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function render() {
    renderRallyOptions();
    renderRallies();
    renderDefenders();
    updateDynamicTimes();
    saveState();
  }

  function renderRallyOptions() {
    const options = state.rallies
      .map((rally, index) => `<option value="${rally.id}">${index + 1}. ${escapeHtml(rally.name || `집결장 ${index + 1}`)}</option>`)
      .join("");
    els.bulkRally.innerHTML = `<option value="">변경 안 함</option>${options}`;
  }

  function renderRallies() {
    els.rallyBody.innerHTML = state.rallies
      .map((rally, index) => {
        const isBase = state.rallies.length <= 5;
        return `
          <tr data-rally-id="${rally.id}">
            <td>${index + 1}</td>
            <td><input data-field="rally-name" value="${escapeHtml(rally.name)}" aria-label="집결장 이름" /></td>
            <td><input data-field="rally-left" value="${escapeHtml(rally.rallyLeft)}" inputmode="numeric" aria-label="남은 집결시간" /></td>
            <td><input data-field="enemy-march" type="number" min="0" value="${escapeHtml(rally.enemyMarch)}" aria-label="상대 행군시간" /></td>
            <td><span class="result-pill" data-rally-countdown="${rally.id}">${formatSeconds(rallyRemainingSeconds(rally))}</span></td>
            <td>
              <div class="row-actions">
                <button class="mini-button apply" data-action="apply-rally" type="button">적용</button>
                <button class="mini-button" data-action="copy-rally" type="button">집결장${index + 1} 복사</button>
              </div>
            </td>
            <td><button class="row-delete" data-action="delete-rally" type="button" ${isBase ? "disabled" : ""}>×</button></td>
          </tr>
        `;
      })
      .join("");
  }

  function renderDefenders() {
    const rallyOptions = (selectedId) =>
      state.rallies
        .map((rally, index) => {
          const label = `${index + 1}. ${rally.name || `집결장 ${index + 1}`}`;
          return `<option value="${rally.id}" ${rally.id === selectedId ? "selected" : ""}>${escapeHtml(label)}</option>`;
        })
        .join("");

    els.defenderBody.innerHTML = state.defenders
      .map((defender, index) => {
        const launch = defenderLaunchSeconds(defender);
        const resultClass = launch < 0 ? "late" : launch <= 10 ? "ready" : "";
        return `
          <tr data-defender-id="${defender.id}">
            <td><input data-field="selected" type="checkbox" ${defender.selected ? "checked" : ""} aria-label="수비원 선택" /></td>
            <td>${index + 1}</td>
            <td><input data-field="defender-name" value="${escapeHtml(defender.name)}" placeholder="닉네임" aria-label="닉네임" /></td>
            <td><input data-field="defender-march" type="number" min="0" value="${escapeHtml(defender.march)}" aria-label="수비원 행군시간" /></td>
            <td><select data-field="defender-rally" aria-label="집결장 선택">${rallyOptions(defender.rallyId)}</select></td>
            <td><span class="result-pill ${resultClass}" data-defender-countdown="${defender.id}">${formatSeconds(launch)}</span></td>
            <td><button class="row-delete" data-action="delete-defender" type="button">×</button></td>
          </tr>
        `;
      })
      .join("");

    els.selectAll.checked = state.defenders.length > 0 && state.defenders.every((defender) => defender.selected);
  }

  function updateDynamicTimes() {
    updateClock();

    state.rallies.forEach((rally) => {
      const badge = document.querySelector(`[data-rally-countdown="${rally.id}"]`);
      if (badge) badge.textContent = formatSeconds(rallyRemainingSeconds(rally));
    });

    state.defenders.forEach((defender) => {
      const badge = document.querySelector(`[data-defender-countdown="${defender.id}"]`);
      if (!badge) return;
      const launch = defenderLaunchSeconds(defender);
      badge.textContent = formatSeconds(launch);
      badge.classList.toggle("late", launch < 0);
      badge.classList.toggle("ready", launch >= 0 && launch <= 10);
    });
  }

  function findRally(id) {
    return state.rallies.find((rally) => rally.id === id);
  }

  function findDefender(id) {
    return state.defenders.find((defender) => defender.id === id);
  }

  function addRally() {
    const rally = {
      id: crypto.randomUUID(),
      name: `집결장 ${state.rallies.length + 1}`,
      rallyLeft: "05:00",
      enemyMarch: 40,
      arrivalAt: null,
    };
    rally.arrivalAt = Date.now() + rallyInputSeconds(rally) * 1000;
    state.rallies.push(rally);
    render();
  }

  function addDefender(defender = {}) {
    state.defenders.push({
      id: crypto.randomUUID(),
      name: defender.name || "",
      march: Number(defender.march || 0),
      rallyId: defender.rallyId || state.rallies[0].id,
      selected: false,
    });
    render();
  }

  function applyRally(rally) {
    rally.rallyLeft = normalizeTimeText(rally.rallyLeft);
    rally.enemyMarch = Number(rally.enemyMarch || 0);
    rally.arrivalAt = Date.now() + rallyInputSeconds(rally) * 1000;
    render();
    showToast(`${rally.name} 적용됨`);
  }

  function copyRally(rally) {
    const defenders = state.defenders.filter((defender) => defender.rallyId === rally.id);
    const text = defenders
      .map((defender) => `${defender.name || "수비원"} ${formatSeconds(defenderLaunchSeconds(defender))}`)
      .join("\n");

    if (!text) {
      showToast("복사할 수비원이 없음");
      return;
    }

    navigator.clipboard.writeText(text).then(
      () => showToast(`${rally.name} 복사 완료`),
      () => showToast("복사 실패")
    );
  }

  function importBulkRows() {
    const lines = els.bulkText.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    let added = 0;

    lines.forEach((line) => {
      const parts = line.split(/[,\t ]+/).filter(Boolean);
      if (parts.length < 2) return;
      const [name, marchText, rallyText] = parts;
      const march = Number(marchText);
      const rallyIndex = Math.max(1, Number(rallyText || 1)) - 1;
      if (!name || !Number.isFinite(march)) return;
      state.defenders.push({
        id: crypto.randomUUID(),
        name,
        march,
        rallyId: state.rallies[rallyIndex]?.id || state.rallies[0].id,
        selected: false,
      });
      added += 1;
    });

    render();
    if (typeof els.bulkDialog.close === "function") els.bulkDialog.close();
    els.bulkText.value = "";
    showToast(`${added}명 추가됨`);
  }

  function applySelected() {
    const marchValue = els.bulkMarch.value.trim();
    const rallyId = els.bulkRally.value;
    let changed = 0;

    state.defenders.forEach((defender) => {
      if (!defender.selected) return;
      if (marchValue) defender.march = Number(marchValue);
      if (rallyId) defender.rallyId = rallyId;
      changed += 1;
    });

    render();
    showToast(`${changed}명 적용됨`);
  }

  function copyResults() {
    const text = state.defenders
      .map((defender) => `${defender.name || "수비원"} ${formatSeconds(defenderLaunchSeconds(defender))}`)
      .join("\n");

    navigator.clipboard.writeText(text).then(
      () => showToast("전체 복사 완료"),
      () => showToast("복사 실패")
    );
  }

  function resetAll() {
    if (!confirm("모든 입력값을 초기화할까요?")) return;
    const fresh = defaultState();
    state.rallies = fresh.rallies;
    state.defenders = fresh.defenders;
    normalizeState(state);
    render();
    showToast("초기화됨");
  }

  function updateClock() {
    const now = new Date();
    els.utcClock.textContent = [
      now.getUTCHours(),
      now.getUTCMinutes(),
      now.getUTCSeconds(),
    ]
      .map((part) => String(part).padStart(2, "0"))
      .join(":");
  }

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.add("show");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => els.toast.classList.remove("show"), 1800);
  }

  els.addRallyBtn.addEventListener("click", addRally);
  els.addDefenderBtn.addEventListener("click", () => addDefender());
  els.applySelectedBtn.addEventListener("click", applySelected);
  els.bulkPasteBtn.addEventListener("click", () => els.bulkDialog.showModal());
  els.importBulkBtn.addEventListener("click", (event) => {
    event.preventDefault();
    importBulkRows();
  });
  els.copyBtn.addEventListener("click", copyResults);
  els.resetBtn.addEventListener("click", resetAll);

  els.selectAll.addEventListener("change", (event) => {
    state.defenders.forEach((defender) => {
      defender.selected = event.target.checked;
    });
    render();
  });

  els.rallyBody.addEventListener("change", (event) => {
    const row = event.target.closest("tr[data-rally-id]");
    const rally = row ? findRally(row.dataset.rallyId) : null;
    if (!rally) return;

    if (event.target.dataset.field === "rally-name") rally.name = event.target.value;
    if (event.target.dataset.field === "rally-left") {
      rally.rallyLeft = normalizeTimeText(event.target.value);
      event.target.value = rally.rallyLeft;
    }
    if (event.target.dataset.field === "enemy-march") rally.enemyMarch = Number(event.target.value || 0);
    saveState();
  });

  els.rallyBody.addEventListener("click", (event) => {
    const row = event.target.closest("tr[data-rally-id]");
    const rally = row ? findRally(row.dataset.rallyId) : null;
    if (!rally) return;

    if (event.target.dataset.action === "apply-rally") {
      applyRally(rally);
      return;
    }

    if (event.target.dataset.action === "copy-rally") {
      copyRally(rally);
      return;
    }

    if (event.target.dataset.action !== "delete-rally" || state.rallies.length <= 5) return;
    const id = row.dataset.rallyId;
    state.rallies = state.rallies.filter((item) => item.id !== id);
    state.defenders.forEach((defender) => {
      if (defender.rallyId === id) defender.rallyId = state.rallies[0].id;
    });
    render();
  });

  els.defenderBody.addEventListener("change", (event) => {
    const row = event.target.closest("tr[data-defender-id]");
    const defender = row ? findDefender(row.dataset.defenderId) : null;
    if (!defender) return;

    if (event.target.dataset.field === "defender-name") defender.name = event.target.value;
    if (event.target.dataset.field === "defender-march") defender.march = Number(event.target.value || 0);
    if (event.target.dataset.field === "selected") defender.selected = event.target.checked;
    if (event.target.dataset.field === "defender-rally") defender.rallyId = event.target.value;
    render();
  });

  els.defenderBody.addEventListener("click", (event) => {
    if (event.target.dataset.action !== "delete-defender") return;
    const row = event.target.closest("tr[data-defender-id]");
    state.defenders = state.defenders.filter((defender) => defender.id !== row.dataset.defenderId);
    render();
  });

  updateClock();
  setInterval(updateDynamicTimes, 1000);
  render();
})();
