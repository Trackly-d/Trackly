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
import { fetchCourses, fetchAssignments } from "./courses-data.js";
import { fetchUserRecord, markWelcomeSkippedSafe } from "./users.js";
import { buildModel, searchItems, formatDue, STATUS_LABELS } from "./assignments.js";
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

let current = null; // { user, model } once the dashboard is drawn

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
    button.setAttribute("data-soon", ""); // delete this line when the Add Assignment page is built
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
function drawTotal(query) {
  const model = current.model;
  if (query) {
    const matches = searchItems(model.items, query);
    fillList(totalPanel, matches, assignmentRow, emptyBlock("No matches", "No assignments match your search.", false));
    return;
  }
  const noAssignments = model.items.length === 0;
  fillList(
    totalPanel,
    model.total,
    assignmentRow,
    noAssignments
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
async function load(user) {
  showView("loading");
  try {
    let record, courses, assignments;
    if (DEMO) {
      ({ courses, assignments } = demoData(DEMO));
      record = { welcomeSkipped: DEMO !== "welcome" };
    } else {
      [record, courses, assignments] = await Promise.all([
        fetchUserRecord(user.uid),
        fetchCourses(user.uid),
        fetchAssignments(user.uid)
      ]);
    }

    current = { user, model: buildModel(courses, assignments) };

    // A brand new student sees the welcome screen. Everyone else goes straight to the dashboard.
    const firstTime = !(record && record.welcomeSkipped) && courses.length === 0 && assignments.length === 0;
    if (firstTime) {
      showView("welcome");
    } else {
      drawMain();
      showView("main");
    }
  } catch (err) {
    console.error("Could not load the dashboard:", err);
    showView("error");
  }
}

skipBtn.addEventListener("click", async () => {
  if (!current) return;
  skipBtn.disabled = true;
  if (!DEMO) await markWelcomeSkippedSafe(current.user);
  drawMain();
  showView("main");
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
    if (current && !views.main.hidden) drawTotal(searchInput.value.trim());
  });
}