/* ==========================================================
   TRACKLY dashboard page
   Shows ONE of these, depending on the student:
     - the welcome screen: a brand new student who has not skipped it and has no courses
     - the dashboard: everyone else
   The sidebar, top bar, sign in check and Sign out are handled by shell.js.
   The rules (status, this week, which rows) are in assignments.js.

   Preview the design without saving anything:
     dashboard.html?demo=1        the dashboard with sample assignments
     dashboard.html?demo=empty    the dashboard for a student with no assignments yet
     dashboard.html?demo=welcome  the welcome screen
   ========================================================== */

import { startApp } from "./shell.js";
import { fetchCourses } from "./courses-data.js";
import { dashboardCounts, dashboardLists, searchPool } from "./assignments-data.js";
import { fetchUserRecord, markWelcomeSkippedSafe } from "./users.js";
import { buildModel, toItems, weekRange, searchItems, formatDue, STATUS_LABELS } from "./assignments.js";
import { el, plural, safeColor } from "./ui.js";
import { courseChipLabel } from "./course-labels.js";

const DEMO = new URLSearchParams(window.location.search).get("demo");

const content = document.getElementById("content");
const views = {
  loading: document.getElementById("state-loading"),
  welcome: document.getElementById("view-welcome"),
  main: document.getElementById("view-main"),
  error: document.getElementById("state-error")
};
const subtitle = document.getElementById("dash-sub");
const totalPanel = document.getElementById("total-panel");
const upcomingPanel = document.getElementById("upcoming-panel");
const skipBtn = document.getElementById("skip-btn");
const retryBtn = document.getElementById("retry-btn");

let current = null; // { user, courses, model, pool } once the dashboard is drawn

const EMPTY_MODEL = { counts: { pending: 0, in_progress: 0, submitted: 0, overdue: 0 }, weekCount: 0, total: [], upcoming: [], totalAll: 0 };

/* ---------- Which of the four things to show ---------- */
function showView(name) {
  Object.keys(views).forEach((key) => { views[key].hidden = key !== name; });
  content.classList.toggle("welcome-page", name === "welcome"); // soft background shapes

  // The wide search box only belongs to the dashboard itself
  const searchBar = document.getElementById("topbar-search");
  const searchBtn = document.getElementById("search-icon-btn");
  if (searchBar) searchBar.hidden = name !== "main";
  if (searchBtn) searchBtn.hidden = name === "main";
}

/* ---------- Small drawing helpers ---------- */
const PILL_CLASS = {
  pending: "pill pill-pending",
  in_progress: "pill pill-progress",
  overdue: "pill pill-overdue",
  submitted: "pill pill-submitted"
};

function emptyBlock(title, text, withButton) {
  const box = el("div", "empty");
  box.append(el("strong", "", title), el("p", "", text));
  if (withButton) {
    const button = el("a", "btn btn-primary", "Add Assignment");
    button.href = "add-assignment.html";
    box.append(button);
  }
  return box;
}

function assignmentRow(item) {
  const row = el("li", "row");

  const chip = el("span", "row-chip", courseChipLabel(item.course));
  if (item.course) chip.title = item.course.title;
  chip.style.setProperty("--course-color", item.course ? safeColor(item.course.color) : "#94A3B8");

  const title = el("span", "row-title", item.title);
  title.title = item.title;

  const main = el("div", "row-main");
  main.append(chip, title);

  const side = el("div", "row-side");
  side.append(el("span", "row-due", item.due ? "Due " + formatDue(item.due) : "No due date"));
  side.append(el("span", PILL_CLASS[item.status], STATUS_LABELS[item.status]));

  row.append(main, side);
  return row;
}

function upcomingRow(item) {
  const row = el("li", "up-row");

  const tile = el("div", "date-tile");
  tile.setAttribute("aria-hidden", "true");
  tile.append(
    el("span", "date-month", item.due.toLocaleDateString("en-US", { month: "short" }).toUpperCase()),
    el("span", "date-day", String(item.due.getDate()))
  );

  const time = item.due.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const text = el("div", "up-text");
  const title = el("p", "up-title", item.title);
  title.title = item.title;
  text.append(title, el("p", "up-meta", (item.course ? item.course.title : "No course") + " \u00B7 " + time));

  row.append(tile, text);
  return row;
}

function fillList(panel, rows, build, emptyEl) {
  panel.replaceChildren();
  if (!rows.length) {
    panel.append(emptyEl);
    return;
  }
  const list = el("ul", "list");
  rows.forEach((item) => list.append(build(item)));
  panel.append(list);
}

/* ---------- The dashboard ---------- */

/* Up to 200 assignments, loaded the first time the student searches, then filtered on the device */
async function getPool() {
  if (current.pool) return current.pool;
  if (DEMO) {
    current.pool = current.model.items || [];
  } else {
    const raw = await searchPool(current.user.uid, null, 200);
    current.pool = toItems(current.courses, raw);
  }
  return current.pool;
}

async function drawTotal(query) {
  const model = current.model;

  if (query) {
    if (!current.pool) {
      fillList(totalPanel, [], assignmentRow, emptyBlock("Searching...", "Looking through your assignments.", false));
    }
    let pool;
    try {
      pool = await getPool();
    } catch (err) {
      console.error("Could not search:", err);
      fillList(totalPanel, [], assignmentRow, emptyBlock("Search is not working", "Check your connection and try again.", false));
      return;
    }
    const box = document.getElementById("global-search");
    if ((box ? box.value.trim() : "") !== query) return; // the student kept typing, a newer search is on its way
    fillList(totalPanel, searchItems(pool, query), assignmentRow, emptyBlock("No matches", "No assignments match your search.", false));
    return;
  }

  fillList(
    totalPanel,
    model.total,
    assignmentRow,
    model.totalAll === 0
      ? emptyBlock("No assignments yet", "Add your first assignment and it will show up here.", true)
      : emptyBlock("You're all caught up", "Everything is submitted. Nice work.", false)
  );
}

function drawMain() {
  const model = current.model;

  subtitle.textContent = model.weekCount === 0
    ? "You have no assignments due this week"
    : "You have " + plural(model.weekCount, "assignment") + " due this week";

  document.getElementById("count-pending").textContent = model.counts.pending;
  document.getElementById("count-progress").textContent = model.counts.in_progress;
  document.getElementById("count-submitted").textContent = model.counts.submitted;
  document.getElementById("count-overdue").textContent = model.counts.overdue;

  const search = document.getElementById("global-search");
  drawTotal(search ? search.value.trim() : "");

  fillList(
    upcomingPanel,
    model.upcoming,
    upcomingRow,
    emptyBlock("Nothing coming up", "Your nearest deadlines will appear here.", false)
  );
}

/* ---------- Sample data for ?demo= ---------- */
function demoData(kind) {
  if (kind === "empty" || kind === "welcome") return { courses: [], assignments: [] };

  const now = Date.now();
  const at = (days, hour = 23, minute = 59) => {
    const d = new Date(now + days * 86400000);
    d.setHours(hour, minute, 0, 0);
    return d;
  };
  const courses = [
    { id: "d1", code: "BIO 101", title: "Biology", color: "#00D996" },
    { id: "d2", code: "ECO 201", title: "Economics", color: "#0E5C4A" },
    { id: "d3", code: "STAT 210", title: "Statistics", color: "#3B82F6" },
    { id: "d4", code: "CHEM 220", title: "Organic Chemistry", color: "#A855F7" },
    { id: "d5", code: "CS 106", title: "Data Structures", color: "#F59E0B" }
  ];
  const a = (courseId, title, dueAt, status) => ({ courseId, title, dueAt, status });
  const assignments = [
    a("d3", "Hypothesis Testing Quiz", at(-2, 17, 0), "pending"),                 // becomes Overdue
    a("d1", "Chapter 5 Essay", at(2), "in_progress"),
    a("d4", "Organic Synthesis Synthesis Lab Report and Reflection", at(5), "in_progress"),
    a("d2", "Macroeconomics Problem Set", at(3, 17, 0), "pending"),
    a("d3", "Linear Regression", at(4), "pending"),
    a("d5", "Binary Trees Assignment", at(6), "pending"),
    a("d1", "Lab Safety Quiz", at(9), "pending"),
    a("d4", "Problem Set 3", at(11), "pending"),
    a("d1", "Cell Structure Notes", at(-20), "submitted"),
    a("d1", "Genetics Worksheet", at(-18), "submitted"),
    a("d2", "Supply and Demand Essay", at(-15), "submitted"),
    a("d2", "Market Structures Quiz", at(-12), "submitted"),
    a("d3", "Probability Basics", at(-10), "submitted"),
    a("d4", "Alkanes Worksheet", at(-8), "submitted"),
    a("d5", "Arrays Lab", at(-6), "submitted"),
    a("d5", "Linked Lists Lab", at(-4), "submitted")
  ];
  return { courses, assignments };
}

/* ---------- Loading ---------- */

/* Counts and the first few rows only. A student with no courses has nothing to count, so no reads at all. */
async function loadModel(user, courses) {
  if (courses.length === 0) return EMPTY_MODEL;

  const now = new Date();
  const [numbers, lists] = await Promise.all([
    dashboardCounts(user.uid, now, weekRange(now).end),
    dashboardLists(user.uid, now)
  ]);
  const c = numbers.counts;
  return {
    counts: c,
    weekCount: numbers.week,
    total: toItems(courses, lists.total, now),
    upcoming: toItems(courses, lists.upcoming, now).filter((item) => item.due),
    totalAll: c.pending + c.in_progress + c.submitted + c.overdue
  };
}

async function load(user) {
  showView("loading");
  try {
    let record, courses, model = null;

    if (DEMO) {
      const demo = demoData(DEMO);
      courses = demo.courses;
      record = { welcomeSkipped: DEMO !== "welcome" };
      const built = buildModel(courses, demo.assignments);
      model = { ...built, totalAll: built.items.length };
    } else {
      [record, courses] = await Promise.all([fetchUserRecord(user.uid), fetchCourses(user.uid)]);
    }

    current = { user, courses, model, pool: null };

    // A brand new student sees the welcome screen. Everyone else goes straight to the dashboard.
    // (A student with no courses cannot have assignments, so we do not count anything for them.)
    const firstTime = !(record && record.welcomeSkipped) && courses.length === 0;
    if (firstTime) {
      showView("welcome");
      return;
    }

    if (!current.model) current.model = await loadModel(user, courses);
    drawMain();
    showView("main");
  } catch (err) {
    console.error("Could not load the dashboard:", err);
    showView("error");
  }
}

skipBtn.addEventListener("click", async () => {
  if (!current) return;
  skipBtn.disabled = true;
  try {
    if (!DEMO) await markWelcomeSkippedSafe(current.user);
    if (!current.model) current.model = await loadModel(current.user, current.courses);
    drawMain();
    showView("main");
  } catch (err) {
    console.error("Could not open the dashboard:", err);
    showView("error");
  }
  skipBtn.disabled = false;
});

startApp("dashboard", (user) => {
  retryBtn.addEventListener("click", () => load(user));
  load(user);
}, { searchBar: true });

// The search box filters the Total Assignments list as the student types
const searchInput = document.getElementById("global-search");
if (searchInput) {
  searchInput.addEventListener("input", () => {
    if (current && current.model && !views.main.hidden) drawTotal(searchInput.value.trim());
  });
}