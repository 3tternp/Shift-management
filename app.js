// Shift Management – Weekly Scheduler
// Random assignment with fairness constraints and week-to-week rotation.

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SHIFTS = ["Morning", "Day", "Night"];
// Default hours per shift; overridden by UI inputs
let SHIFT_HOURS = { Morning: 8, Day: 8, Night: 8 };

const els = {
  staffNames: document.getElementById("staffNames"),
  staffPerShift: document.getElementById("staffPerShift"),
  generateBtn: document.getElementById("generateBtn"),
  nextWeekBtn: document.getElementById("nextWeekBtn"),
  clearBtn: document.getElementById("clearBtn"),
  scheduleSection: document.getElementById("scheduleSection"),
  scheduleContainer: document.getElementById("scheduleContainer"),
  exportCsv: document.getElementById("exportCsv"),
  exportStatsCsv: document.getElementById("exportStatsCsv"),
  exportOffCsv: document.getElementById("exportOffCsv"),
  errorBox: document.getElementById("errorBox"),
  fileInput: document.getElementById("fileInput"),
  importMeta: document.getElementById("importMeta"),
  importCount: document.getElementById("importCount"),
  importCols: document.getElementById("importCols"),
  // Staff manager UI
  newStaffName: document.getElementById("newStaffName"),
  addStaffBtn: document.getElementById("addStaffBtn"),
  clearStaffBtn: document.getElementById("clearStaffBtn"),
  staffList: document.getElementById("staffList"),
  // Shift hours inputs
  hoursMorning: document.getElementById("hoursMorning"),
  hoursDay: document.getElementById("hoursDay"),
  hoursNight: document.getElementById("hoursNight"),
  // Work stats UI
  workStatsSection: document.getElementById("workStatsSection"),
  workStatsContainer: document.getElementById("workStatsContainer"),
  offDaysSection: document.getElementById("offDaysSection"),
  offDaysContainer: document.getElementById("offDaysContainer"),
};

// Utilities
function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function uniqueNonEmptyLines(text) {
  const lines = text
    .split(/\r?\n/) // split on new lines
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  // keep order, remove duplicates
  const seen = new Set();
  const result = [];
  for (const name of lines) {
    if (!seen.has(name)) {
      seen.add(name);
      result.push(name);
    }
  }
  return result;
}

function showError(msg) {
  els.errorBox.textContent = msg;
  els.errorBox.hidden = false;
}
function clearError() {
  els.errorBox.textContent = "";
  els.errorBox.hidden = true;
}

// Persist last week schedule stats to bias next week's rotation
const STORAGE_KEY = "soc_shift_last_week";

function saveLastWeekStats(stats) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
  } catch {}
}

function loadLastWeekStats() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// Build fairness-aware weekly schedule
let unavailabilityByStaff = {}; // { name: Set(dayName) }

// Staff Manager persistence
const STAFF_STORAGE_KEY = "shift_staff_manager";

let staffManagerState = []; // [{ name: string, unavailable: Set(DAY) }]

function saveStaffManager() {
  try {
    const serializable = staffManagerState.map((s) => ({
      name: s.name,
      unavailable: Array.from(s.unavailable || []),
    }));
    localStorage.setItem(STAFF_STORAGE_KEY, JSON.stringify(serializable));
  } catch {}
}

function loadStaffManager() {
  try {
    const raw = localStorage.getItem(STAFF_STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr)
      ? arr.map((s) => ({ name: s.name, unavailable: new Set(s.unavailable || []) }))
      : [];
  } catch {
    return [];
  }
}

function getDayCheckboxes() {
  return Array.from(document.querySelectorAll(".dayChk"));
}

function getCheckedDays() {
  return new Set(
    getDayCheckboxes()
      .filter((chk) => chk.checked)
      .map((chk) => chk.value)
  );
}

function clearDayChecks() {
  for (const chk of getDayCheckboxes()) chk.checked = false;
}

function renderStaffList() {
  if (!els.staffList) return;
  els.staffList.innerHTML = "";
  for (const entry of staffManagerState) {
    const card = document.createElement("div");
    card.className = "staff-card";

    const nameEl = document.createElement("span");
    nameEl.className = "staff-name";
    nameEl.textContent = entry.name;

    const unavailEl = document.createElement("span");
    unavailEl.className = "unavail";
    const days = Array.from(entry.unavailable || []).join(", ");
    unavailEl.textContent = days ? `(Unavailable: ${days})` : "(Available all days)";

    const removeBtn = document.createElement("button");
    removeBtn.className = "remove-btn";
    removeBtn.textContent = "Remove";
    removeBtn.dataset.name = entry.name;

    card.appendChild(nameEl);
    card.appendChild(unavailEl);
    card.appendChild(removeBtn);
    els.staffList.appendChild(card);
  }
}

function updateTextAreaFromManager() {
  if (staffManagerState.length) {
    els.staffNames.value = staffManagerState.map((s) => s.name).join("\n");
  }
}

function updateUnavailabilityMapFromManager() {
  unavailabilityByStaff = Object.fromEntries(
    staffManagerState.map((s) => [s.name, new Set(s.unavailable || [])])
  );
}

function generateWeeklySchedule(staff, staffPerShift, lastWeekStats, unavailability) {
  // Validation: require enough staff to avoid double-shifts in a day
  const requiredPerDay = SHIFTS.length * staffPerShift;
  // Additional feasibility: each staff must have 2 off days => max 5 workdays
  const weeklySlots = SHIFTS.length * 7 * staffPerShift; // total assignment slots in week
  const maxSlotsByStaffCap = staff.length * 5; // each staff can work at most 5 days
  if (staff.length < requiredPerDay) {
    throw new Error(
      `Not enough staff. Need at least ${requiredPerDay} for ${SHIFTS.length} shifts x ${staffPerShift} per shift per day.`
    );
  }
  if (maxSlotsByStaffCap < weeklySlots) {
    const minStaffNeeded = Math.ceil(weeklySlots / 5);
    throw new Error(
      `Schedule not feasible with 2 off-days policy. Need at least ${minStaffNeeded} staff for ${staffPerShift} per shift.`
    );
  }

  // Stats to track fairness
  const weeklyCounts = Object.fromEntries(staff.map((s) => [s, 0]));
  const lastShiftByStaff = Object.fromEntries(staff.map((s) => [s, null]));
  const shiftTypeCounts = Object.fromEntries(
    staff.map((s) => [s, { Morning: 0, Day: 0, Night: 0 }])
  );

  // Seed from last week to rotate people across shift types
  if (lastWeekStats && lastWeekStats.shiftTypeCounts) {
    for (const s of staff) {
      const prev = lastWeekStats.shiftTypeCounts[s];
      if (prev) {
        shiftTypeCounts[s] = { ...prev };
      }
    }
  }

  // Schedule structure: { day: { shiftName: [staff,...] } }
  const schedule = {};

  for (let d = 0; d < DAYS.length; d++) {
    const dayName = DAYS[d];
    schedule[dayName] = {};

    const assignedToday = new Set();
    // Create a fresh randomized order to break ties daily
    const baseOrder = shuffle([...staff]);

    for (const shift of SHIFTS) {
      const assigned = [];

      // Candidate pool: not already assigned today and not exceeding 5 workdays
      let pool = baseOrder.filter((s) => !assignedToday.has(s) && weeklyCounts[s] < 5);
      // Respect unavailability per day
      if (unavailability) {
        pool = pool.filter(
          (s) => !(unavailability[s] && unavailability[s].has(dayName))
        );
      }

      // Soft constraints first: avoid repeating same shift as previous day, avoid consecutive nights
      const preferred = pool.filter((s) => {
        const last = lastShiftByStaff[s];
        const avoidSameShift = last !== shift; // prefer change of shift type day-to-day
        const avoidConsecutiveNight = !(last === "Night" && shift === "Night");
        return avoidSameShift && avoidConsecutiveNight;
      });

      // Rank by fairness: fewer weekly assignments and fewer same shift types from last rotation
      const ranker = (list) =>
        list
          .map((s) => ({
            s,
            score:
              weeklyCounts[s] +
              // prefer those with fewer of the same shift historically
              shiftTypeCounts[s][shift] * 0.6 +
              // small random to break ties
              Math.random() * 0.2,
          }))
          .sort((a, b) => a.score - b.score)
          .map((x) => x.s);

      let ordered = ranker(preferred);

      // If not enough candidates after constraints, relax constraints gradually.
      if (ordered.length < staffPerShift) {
        const relaxedPool = pool.filter((s) => {
          const last = lastShiftByStaff[s];
          const avoidConsecutiveNight = !(last === "Night" && shift === "Night");
          return avoidConsecutiveNight; // allow same shift type day-to-day if needed
        });
        ordered = ranker(relaxedPool);
      }

      if (ordered.length < staffPerShift) {
        // Fully relax if still insufficient
        ordered = ranker(pool);
      }

      for (const s of ordered) {
        if (assigned.length >= staffPerShift) break;
        assigned.push(s);
        assignedToday.add(s);
        weeklyCounts[s] += 1;
        shiftTypeCounts[s][shift] += 1;
        lastShiftByStaff[s] = shift;
      }

      // Final guard: if still insufficient, throw clear error for user to adjust
      if (assigned.length < staffPerShift) {
        throw new Error(
          `Insufficient candidates for ${shift} on ${dayName}. Increase staff list or reduce staff per shift.`
        );
      }

      schedule[dayName][shift] = assigned;
    }
  }

  // Return schedule along with stats for persistence
  return {
    schedule,
    stats: { weeklyCounts, shiftTypeCounts },
  };
}

function computeWorkStats(schedule, allStaff) {
  // Build per-staff stats: days worked, days off, total hours
  const perStaff = {};
  // Initialize with all staff to include zero-assignment cases
  for (const name of allStaff || []) {
    perStaff[name] = { daysWorked: 0, hoursWorked: 0 };
  }
  // Also include any names present in schedule (defensive)
  for (const day of DAYS) {
    for (const shift of SHIFTS) {
      const assigned = schedule[day][shift] || [];
      for (const name of assigned) {
        if (!perStaff[name]) perStaff[name] = { daysWorked: 0, hoursWorked: 0 };
      }
    }
  }
  // Aggregate
  for (const day of DAYS) {
    for (const shift of SHIFTS) {
      const assigned = schedule[day][shift] || [];
      for (const name of assigned) {
        perStaff[name].daysWorked += 1;
        perStaff[name].hoursWorked += SHIFT_HOURS[shift] || 0;
      }
    }
  }
  // Finalize with days off
  for (const name of Object.keys(perStaff)) {
    const worked = perStaff[name].daysWorked;
    perStaff[name].daysOff = Math.max(0, 7 - worked);
  }
  return perStaff;
}

function computeOffByDay(schedule, allStaff) {
  const offMap = {};
  const everyone = new Set(allStaff || []);
  for (const day of DAYS) {
    const assignedSet = new Set();
    for (const shift of SHIFTS) {
      const assigned = schedule[day][shift] || [];
      for (const name of assigned) assignedSet.add(name);
    }
    const offList = Array.from(everyone).filter((name) => !assignedSet.has(name));
    offMap[day] = offList.sort((a, b) => a.localeCompare(b));
  }
  return offMap;
}

function renderOffDays(offMap) {
  if (!els.offDaysSection || !els.offDaysContainer) return;
  els.offDaysSection.hidden = false;
  const container = document.createElement("div");
  container.className = "table-wrap";

  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const tbody = document.createElement("tbody");

  const headerRow = document.createElement("tr");
  for (const h of ["Day", "Off Staff"]) {
    const th = document.createElement("th");
    th.textContent = h;
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);

  for (const day of DAYS) {
    const tr = document.createElement("tr");
    const tdDay = document.createElement("td");
    tdDay.textContent = day;
    tr.appendChild(tdDay);

    const tdList = document.createElement("td");
    const names = offMap[day] || [];
    if (names.length === 0) {
      tdList.textContent = "—";
    } else {
      for (const name of names) {
        const pill = document.createElement("span");
        pill.className = "staff-pill";
        pill.textContent = name;
        tdList.appendChild(pill);
      }
    }
    tr.appendChild(tdList);
    tbody.appendChild(tr);
  }

  table.appendChild(thead);
  table.appendChild(tbody);
  container.appendChild(table);
  els.offDaysContainer.innerHTML = "";
  els.offDaysContainer.appendChild(container);
}

function offDaysToCsv(offMap) {
  const rows = [];
  rows.push(["Day", "OffStaff"].join(","));
  for (const day of DAYS) {
    const names = (offMap[day] || []).join(" | ");
    rows.push([day, names].join(","));
  }
  return rows.join("\n");
}

function updateOffExportLink(offMap) {
  if (!els.exportOffCsv) return;
  const csv = offDaysToCsv(offMap);
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  els.exportOffCsv.href = url;
}

function renderWorkStats(stats) {
  if (!els.workStatsSection || !els.workStatsContainer) return;
  els.workStatsSection.hidden = false;
  const container = document.createElement("div");
  container.className = "table-wrap";

  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const tbody = document.createElement("tbody");

  const headerRow = document.createElement("tr");
  for (const h of ["Staff", "Days Worked", "Days Off", "Hours Worked"]) {
    const th = document.createElement("th");
    th.textContent = h;
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);

  const names = Object.keys(stats).sort((a, b) => a.localeCompare(b));
  for (const name of names) {
    const tr = document.createElement("tr");
    const tdName = document.createElement("td");
    tdName.textContent = name;
    tr.appendChild(tdName);

    const tdDaysWorked = document.createElement("td");
    tdDaysWorked.textContent = String(stats[name].daysWorked || 0);
    tr.appendChild(tdDaysWorked);

    const tdDaysOff = document.createElement("td");
    tdDaysOff.textContent = String(stats[name].daysOff || 0);
    tr.appendChild(tdDaysOff);

    const tdHours = document.createElement("td");
    tdHours.textContent = String(stats[name].hoursWorked || 0);
    tr.appendChild(tdHours);

    tbody.appendChild(tr);
  }

  table.appendChild(thead);
  table.appendChild(tbody);
  container.appendChild(table);

  els.workStatsContainer.innerHTML = "";
  els.workStatsContainer.appendChild(container);
}

function statsToCsv(stats) {
  const rows = [];
  rows.push(["Staff", "DaysWorked", "DaysOff", "HoursWorked"].join(","));
  for (const name of Object.keys(stats)) {
    const { daysWorked = 0, daysOff = 0, hoursWorked = 0 } = stats[name] || {};
    rows.push([name, daysWorked, daysOff, hoursWorked].join(","));
  }
  return rows.join("\n");
}

function updateStatsExportLink(stats) {
  if (!els.exportStatsCsv) return;
  const csv = statsToCsv(stats);
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  els.exportStatsCsv.href = url;
}

function renderSchedule(schedule) {
  els.scheduleSection.hidden = false;
  const container = document.createElement("div");
  container.className = "table-wrap";

  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const tbody = document.createElement("tbody");

  // Header row: Shift + 7 days
  const headerRow = document.createElement("tr");
  const thShift = document.createElement("th");
  thShift.textContent = "Shift";
  headerRow.appendChild(thShift);
  for (const day of DAYS) {
    const th = document.createElement("th");
    th.textContent = day;
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);

  // Body rows: Morning, Day, Night
  for (const shift of SHIFTS) {
    const tr = document.createElement("tr");
    const tdBadge = document.createElement("td");
    const badge = document.createElement("span");
    badge.className = `shift-badge shift-${shift.toLowerCase()}`;
    badge.textContent = shift;
    tdBadge.appendChild(badge);
    tr.appendChild(tdBadge);

    for (const day of DAYS) {
      const td = document.createElement("td");
      const assigned = schedule[day][shift];
      for (const name of assigned) {
        const pill = document.createElement("span");
        pill.className = "staff-pill";
        pill.textContent = name;
        td.appendChild(pill);
      }
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }

  table.appendChild(thead);
  table.appendChild(tbody);
  container.appendChild(table);

  els.scheduleContainer.innerHTML = "";
  els.scheduleContainer.appendChild(container);
}

function scheduleToCsv(schedule) {
  const rows = [];
  rows.push(["Day", "Shift", "Assigned"].join(","));
  for (const day of DAYS) {
    for (const shift of SHIFTS) {
      const assigned = schedule[day][shift];
      rows.push([day, shift, assigned.join(" | ")].join(","));
    }
  }
  return rows.join("\n");
}

function updateExportLink(schedule) {
  const csv = scheduleToCsv(schedule);
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  els.exportCsv.href = url;
}

function getConfig() {
  clearError();
  const staff = uniqueNonEmptyLines(els.staffNames.value);
  const staffPerShift = parseInt(els.staffPerShift.value, 10);
  if (!Array.isArray(staff) || staff.length === 0) {
    throw new Error("Please provide at least one staff name (one per line).");
  }
  if (!Number.isFinite(staffPerShift) || staffPerShift < 1) {
    throw new Error("Staff per shift must be a positive integer.");
  }
  // Read shift hours
  const hMorning = parseInt(els.hoursMorning?.value || "8", 10);
  const hDay = parseInt(els.hoursDay?.value || "8", 10);
  const hNight = parseInt(els.hoursNight?.value || "8", 10);
  if (![hMorning, hDay, hNight].every((n) => Number.isFinite(n) && n > 0)) {
    throw new Error("Shift hours must be positive integers.");
  }
  SHIFT_HOURS = { Morning: hMorning, Day: hDay, Night: hNight };
  return { staff, staffPerShift };
}

function generateAndRender({ useRotationBias = false } = {}) {
  try {
    const { staff, staffPerShift } = getConfig();
    // Prefer Staff Manager as source if it has entries
    const managerHasEntries = staffManagerState.length > 0;
    const sourceStaff = managerHasEntries ? staffManagerState.map((s) => s.name) : staff;
    const unavailSource = managerHasEntries ? Object.fromEntries(staffManagerState.map((s) => [s.name, new Set(s.unavailable || [])])) : unavailabilityByStaff;
    const lastWeekStats = useRotationBias ? loadLastWeekStats() : null;
    const { schedule, stats } = generateWeeklySchedule(
      sourceStaff,
      staffPerShift,
      lastWeekStats,
      unavailSource
    );
    renderSchedule(schedule);
    updateExportLink(schedule);
    const workStats = computeWorkStats(schedule, sourceStaff);
    renderWorkStats(workStats);
    updateStatsExportLink(workStats);
    const offMap = computeOffByDay(schedule, sourceStaff);
    renderOffDays(offMap);
    updateOffExportLink(offMap);
    saveLastWeekStats(stats);
  } catch (err) {
    showError(err.message || String(err));
  }
}

// Wire up events
els.generateBtn.addEventListener("click", () => generateAndRender({ useRotationBias: false }));
els.nextWeekBtn.addEventListener("click", () => generateAndRender({ useRotationBias: true }));
els.clearBtn.addEventListener("click", () => {
  els.staffNames.value = "";
  els.scheduleSection.hidden = true;
  els.scheduleContainer.innerHTML = "";
  clearError();
  els.importMeta.hidden = true;
  unavailabilityByStaff = {};
});

// Initialize with a sensible placeholder list
els.staffNames.value = [
  "Alice",
  "Bob",
  "Charlie",
  "David",
  "Eve",
  "Frank",
  "Grace",
  "Heidi",
  "Ivan",
  "Judy",
  "Mallory",
  "Niaj",
  "Olivia",
  "Peggy",
].join("\n");
// Import Excel/CSV
function normalizeHeader(h) {
  return String(h || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

function parseUnavailableDays(text) {
  if (!text) return new Set();
  const tokens = String(text)
    .split(/[;,\s]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  const set = new Set();
  for (const t of tokens) {
    const key = t.slice(0, 3).toLowerCase();
    const map = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
    if (map[key]) set.add(map[key]);
  }
  return set;
}

async function handleFile(file) {
  clearError();
  try {
    const isCsv = file.name.toLowerCase().endsWith(".csv");
    const arrayBuffer = await file.arrayBuffer();
    const wb = XLSX.read(arrayBuffer, { type: "array" });
    const sheetName = wb.SheetNames[0];
    const sheet = wb.Sheets[sheetName];
    // Get rows with first row as header array
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    if (!rows.length) throw new Error("No rows found in the file.");

    // Find header row (first non-empty row)
    let header = rows[0];
    let startIdx = 1;
    const nonEmpty = (r) => r.some((c) => String(c).trim().length > 0);
    if (!nonEmpty(header)) {
      for (let i = 1; i < rows.length; i++) {
        if (nonEmpty(rows[i])) {
          header = rows[i];
          startIdx = i + 1;
          break;
        }
      }
    }
    const norm = header.map((h) => normalizeHeader(h));

    // Identify columns
    let nameIdx = norm.findIndex((h) => h.includes("name"));
    if (nameIdx === -1) nameIdx = 0; // fallback to first column
    const unavailableIdx = norm.findIndex(
      (h) => h.includes("unavailable") || h.includes("unavailabledays") || h.includes("availability")
    );
    const perShiftIdx = norm.findIndex((h) => h.includes("staffpershift") || h.includes("pershift"));

    const names = [];
    unavailabilityByStaff = {};

    for (let r = startIdx; r < rows.length; r++) {
      const row = rows[r];
      const rawName = row[nameIdx];
      const name = String(rawName || "").trim();
      if (!name) continue;
      if (!names.includes(name)) names.push(name);

      if (unavailableIdx !== -1) {
        unavailabilityByStaff[name] = parseUnavailableDays(row[unavailableIdx]);
      }
    }

    if (!names.length) throw new Error("Could not find any staff names. Ensure the sheet has a Name column.");
    els.staffNames.value = names.join("\n");
    els.importCount.textContent = String(names.length);

    const colsDetected = [];
    colsDetected.push(header[nameIdx] || "Column 1");
    if (unavailableIdx !== -1) colsDetected.push(header[unavailableIdx] || "UnavailableDays");
    if (perShiftIdx !== -1) {
      colsDetected.push(header[perShiftIdx] || "StaffPerShift");
      // Try to read a numeric value from the first data row
      for (let r = startIdx; r < rows.length; r++) {
        const v = rows[r][perShiftIdx];
        const n = parseInt(String(v).trim(), 10);
        if (Number.isFinite(n) && n > 0) {
          els.staffPerShift.value = String(n);
          break;
        }
      }
    }

    els.importCols.textContent = colsDetected.join(", ");
    els.importMeta.hidden = false;
  } catch (err) {
    showError(err.message || String(err));
  }
}

if (els.fileInput) {
  els.fileInput.addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) handleFile(file);
  });
}

// Staff Manager handlers
function addStaff() {
  clearError();
  const name = (els.newStaffName?.value || "").trim();
  if (!name) {
    showError("Please enter a staff name.");
    return;
  }
  // prevent duplicates (case-insensitive)
  const exists = staffManagerState.some((s) => s.name.toLowerCase() === name.toLowerCase());
  if (exists) {
    showError("This staff name already exists in the manager.");
    return;
  }
  const unavailable = getCheckedDays();
  staffManagerState.push({ name, unavailable });
  saveStaffManager();
  renderStaffList();
  updateTextAreaFromManager();
  updateUnavailabilityMapFromManager();
  if (els.newStaffName) els.newStaffName.value = "";
  clearDayChecks();
}

function removeStaff(name) {
  staffManagerState = staffManagerState.filter((s) => s.name !== name);
  saveStaffManager();
  renderStaffList();
  updateTextAreaFromManager();
  updateUnavailabilityMapFromManager();
}

function clearAllStaff() {
  staffManagerState = [];
  saveStaffManager();
  renderStaffList();
  updateTextAreaFromManager();
  updateUnavailabilityMapFromManager();
}

if (els.addStaffBtn) {
  els.addStaffBtn.addEventListener("click", addStaff);
}
if (els.clearStaffBtn) {
  els.clearStaffBtn.addEventListener("click", clearAllStaff);
}
if (els.staffList) {
  els.staffList.addEventListener("click", (e) => {
    const target = e.target;
    if (target && target.matches(".remove-btn")) {
      const name = target.dataset.name;
      if (name) removeStaff(name);
    }
  });
}

// Initialize Staff Manager from storage
staffManagerState = loadStaffManager();
renderStaffList();
updateTextAreaFromManager();
updateUnavailabilityMapFromManager();