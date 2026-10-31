/* ==========================================================
   TRACKLY assignments page
   Every assignment from every course, 20 at a time.

   To keep Firestore reads low, the page does NOT download every assignment:
     - the header numbers come from count questions (shared with the dashboard, remembered for a minute)
     - the list loads one page of 20 for the chosen chip, and "Show more" loads the next 20
     - searching loads up to 200 assignments once, then filters them on the device

   The chip you chose is remembered while you move around during the same visit.
   A fresh visit (a new tab, or opening the app again) starts on All.

   Try the design with sample data (nothing is saved):
     assignments.html?demo=1          16 assignments in 3 courses
     assignments.html?demo=many       60 assignments (to try Show more)
     assignments.html?demo=empty      courses, but no assignments yet
     assignments.html?demo=nocourses  a student with no courses yet
   ========================================================== */

import { startApp, icon, showToast } from "./shell.js";
import { fetchCourses } from "./courses-data.js";
import { dashboardCounts, createPager, searchPool } from "./assignments-data.js";
import { toItems, weekRange, filterAssignmentItems, dueWithDay, shortDate, STATUS_LABELS } from "./assignments.js";
import { courseChipLabel } from "./course-labels.js";
import { el, safeColor } from "./ui.js";
import { reminderNotice } from "./calendar-sync.js";

const PAGE_SIZE = 20;
const FILTERS = ["all", "pending", "in_progress", "submitted", "overdue"];

const DEMO = new URLSearchParams(window.location.search).get("demo");

const $ = (id) => document.getElementById(id);
const views = {
  loading: $("as-loading"),
  page: $("assignments-page"),
  error: $("as-error")
};
const list = $("task-list");
const moreBtn = $("show-more");
const chipButtons = Array.from(document.querySelectorAll(".filter-chip"));

const PILL_CLASS = {
  pending: "pill pill-pending",
  in_progress: "pill pill-progress",
  overdue: "pill pill-overdue",
  submitted: "pill pill-submitted"
};

let uid = "";
let courses = [];
let counts = { pending: 0, in_progress: 0, submitted: 0, overdue: 0, total: 0 };
let filter = "all";
let query = "";
let items = [];         // the rows loaded so far, for itemsFilter
let itemsFilter = "all";
let hasMore = false;
let loadingMore = false;
let source = null;      // gives pages of rows: from Firestore, or from sample data
let token = 0;          // lets us ignore answers that arrive late
let pool = null;        // up to 200 assignments, for searching
let poolPromise = null;

/* ---------- Which of the three things to show ---------- */
function showView(name) {
  Object.keys(views).forEach((key) => { views[key].hidden = key !== name; });
}

/* ---------- Remembering the chip during this visit ---------- */
const filterKey = () => "trackly:filter:" + uid + ":assignments";

function rememberedFilter() {
  try {
    const saved = window.sessionStorage.getItem(filterKey());
    return FILTERS.includes(saved) ? saved : "all";
  } catch (err) {
    return "all";
  }
}

function rememberFilter(value) {
  try {
    window.sessionStorage.setItem(filterKey(), value);
  } catch (err) { /* storage blocked: the chip simply is not remembered */ }
}

function paintChips() {
  chipButtons.forEach((chip) => chip.setAttribute("aria-pressed", String(chip.dataset.filter === filter)));
}

/* ---------- Where the rows come from ---------- */

/* Real data: one page of 20 at a time from Firestore, across every course */
function serverSource() {
  let pager = null;
  const toRows = (page) => ({ items: toItems(courses, page.items), hasMore: page.hasMore });
  return {
    async reset(chip) {
      pager = createPager(uid, chip, new Date(), null, PAGE_SIZE);
      return toRows(await pager.loadMore());
    },
    async more() {
      return toRows(await pager.loadMore());
    }
  };
}

/* Sample data: the same pages, cut from a list we already have */
function localSource(all) {
  let rows = [];
  let shown = 0;
  const take = () => {
    const slice = rows.slice(shown, shown + PAGE_SIZE);
    shown += slice.length;
    return { items: slice, hasMore: shown < rows.length };
  };
  return {
    async reset(chip) {
      rows = filterAssignmentItems(all, chip, "");
      shown = 0;
      return take();
    },
    async more() {
      return take();
    }
  };
}

/* ---------- Drawing helpers ---------- */
function iconSpan(name, className) {
  const span = el("span", className || "icon-wrap");
  span.setAttribute("aria-hidden", "true");
  span.innerHTML = icon(name); // fixed icon markup from shell.js, not student text
  return span;
}

function dueText(item) {
  if (item.status === "submitted") {
    return item.submitted ? "Submitted " + shortDate(item.submitted) : "Submitted";
  }
  return item.due ? "Due " + dueWithDay(item.due) : "No due date";
}

function assignmentRow(item) {
  const li = el("li", "task");

  const link = el("a", "task-link");
  link.href = "assignment.html?id=" + encodeURIComponent(item.id);

  const chip = el("span", "task-chip", courseChipLabel(item.course));
  chip.style.setProperty("--course-color", item.course ? safeColor(item.course.color) : "#94A3B8");
  chip.title = item.course ? item.course.title || "" : "";

  const title = el("p", "task-title", item.title);
  title.title = item.title;
  const text = el("div", "task-text");
  text.append(title);

  const main = el("div", "task-main");
  main.append(chip, text);

  const dueClass = item.status === "overdue" ? " is-overdue" : item.status === "submitted" ? " is-done" : "";
  const due = el("span", "task-due" + dueClass);
  due.append(iconSpan(item.status === "submitted" ? "checkCircle" : "calendar"), document.createTextNode(dueText(item)));

  const side = el("div", "task-side");
  side.append(due, el("span", PILL_CLASS[item.status], STATUS_LABELS[item.status]), iconSpan("chevron", "task-go"));

  link.append(main, side);
  li.append(link);
  return li;
}

/* ---------- The header ---------- */
function drawHeader() {
  const totals = $("as-totals");
  totals.replaceChildren();
  [counts.total + " total", counts.pending + " pending", counts.overdue + " overdue"].forEach((text) => {
    totals.append(el("span", "", text));
  });
}

/* ---------- The list ---------- */
const isSearching = () => query.trim() !== "";

function visibleRows() {
  if (!isSearching()) return items;
  // While the 200 are still loading, search what is already on screen
  return filterAssignmentItems(pool || items, filter, query);
}

function drawList() {
  const hasCourses = courses.length > 0;
  const hasAny = counts.total > 0;
  const rows = visibleRows();

  // What the student sees depends on where they are: no courses, no assignments, or both
  $("no-courses").hidden = hasCourses;
  $("no-assignments").hidden = !(hasCourses && !hasAny);
  $("new-assignment").hidden = !hasCourses;
  $("as-totals").hidden = !hasCourses;
  document.querySelector(".filters-row").hidden = !(hasCourses && hasAny);

  list.replaceChildren();
  rows.forEach((item) => list.append(assignmentRow(item)));
  list.hidden = rows.length === 0;
  $("no-match").hidden = !(hasAny && rows.length === 0);

  moreBtn.hidden = isSearching() || !hasMore;
  moreBtn.disabled = loadingMore;
  moreBtn.textContent = loadingMore ? "Loading..." : "Show more";
}

/* Loads the first page for the chosen chip */
async function resetList() {
  const mine = ++token;
  list.setAttribute("aria-busy", "true");
  try {
    const page = await source.reset(filter);
    if (mine !== token) return; // the student already chose something else
    items = page.items;
    hasMore = page.hasMore;
    itemsFilter = filter;
  } catch (err) {
    if (mine !== token) return;
    console.error("Could not load the list:", err);
    showToast("Could not load the list. Try again.");
  }
  list.removeAttribute("aria-busy");
  drawList();
}

async function showMore() {
  if (loadingMore || !hasMore) return;
  loadingMore = true;
  drawList();
  const mine = token;
  try {
    const page = await source.more();
    if (mine === token) {
      items = items.concat(page.items);
      hasMore = page.hasMore;
    }
  } catch (err) {
    console.error("Could not load more:", err);
    showToast("Could not load more. Try again.");
  }
  loadingMore = false;
  drawList();
}

/* After the chip or the search box changes */
function sync() {
  if (isSearching() || itemsFilter === filter) {
    drawList();
  } else {
    resetList();
  }
}

/* The first search loads up to 200 assignments, once */
function ensurePool() {
  if (pool) return Promise.resolve(pool);
  if (!poolPromise) {
    poolPromise = searchPool(uid, null, 200)
      .then((raw) => { pool = toItems(courses, raw); return pool; })
      .catch((err) => {
        console.error("Could not load the assignments to search:", err);
        poolPromise = null;
        showToast("Search could not load everything. Showing what is on screen.");
        return null;
      });
  }
  return poolPromise;
}

/* ---------- Sample data for ?demo= ---------- */
function demoData(kind) {
  const demoCourses = [
    { id: "d1", code: "BIO 101", title: "Introduction to Biology", color: "#00D996" },
    { id: "d2", code: "ECO 201", title: "Microeconomics", color: "#3B82F6" },
    { id: "d3", code: "STAT 210", title: "Statistics & Probability", color: "#A855F7" },
    { id: "d4", code: "CS 106", title: "Data Structures & Algorithms", color: "#F59E0B" }
  ];
  if (kind === "nocourses") return { courses: [], assignments: [] };
  if (kind === "empty") return { courses: demoCourses, assignments: [] };

  const at = (days, hour = 23, minute = 59) => {
    const d = new Date(Date.now() + days * 86400000);
    d.setHours(hour, minute, 0, 0);
    return d;
  };
  const a = (courseId, title, dueDays, status, submittedDaysAgo) => ({
    id: "d-" + courseId + "-" + title,
    courseId,
    title,
    dueAt: at(dueDays),
    status,
    submittedAt: submittedDaysAgo === undefined ? undefined : at(-submittedDaysAgo, 14, 0)
  });
  const assignments = [
    a("d1", "Cell Structure Lab Report", -7, "pending"),            // becomes Overdue
    a("d1", "Chapter 5 Essay", 2, "in_progress"),
    a("d2", "Macroeconomics Problem Set", 5, "pending"),
    a("d3", "Linear Regression Analysis", -10, "submitted", 11),
    a("d4", "A very long assignment title that should be cut off with three dots before it reaches the date", 9, "pending"),
    a("d4", "Binary Trees Assignment", 6, "pending"),
    a("d2", "Supply and Demand Essay", -15, "submitted", 16),
    a("d3", "Hypothesis Testing Quiz", -3, "in_progress"),         // becomes Overdue
    a("d1", "Lab Safety Quiz", -30, "submitted", 31),
    a("d1", "Photosynthesis Quiz", -18, "submitted", 19),
    a("d4", "Arrays Lab", -6, "submitted", 7),
    a("d3", "Probability Basics", -12, "submitted", 13),
    a("d2", "Market Structures Quiz", 12, "pending"),
    a("d1", "Midterm Study Guide", 14, "pending"),
    a("d4", "Linked Lists Lab", 4, "in_progress"),
    a("d3", "Regression Project", 20, "pending")
  ];

  // demo=many: 44 more, so there is more than one page
  if (kind === "many") {
    const ids = ["d1", "d2", "d3", "d4"];
    for (let i = 1; i <= 44; i += 1) {
      const status = i % 3 === 0 ? "pending" : i % 3 === 1 ? "in_progress" : "submitted";
      const overdue = i % 5 === 0;
      assignments.push(a(ids[i % 4], "Practice Set " + i, overdue ? -(i + 2) : i + 2, status === "submitted" ? "submitted" : status, status === "submitted" ? i : undefined));
    }
  }
  return { courses: demoCourses, assignments };
}

/* ---------- Loading ---------- */
function countsFrom(rows) {
  const c = { pending: 0, in_progress: 0, submitted: 0, overdue: 0 };
  rows.forEach((row) => { c[row.status] += 1; });
  return { ...c, total: rows.length };
}

/* The header numbers. A student with no courses has nothing to count, so no reads at all. */
async function loadCounts() {
  const none = { pending: 0, in_progress: 0, submitted: 0, overdue: 0, total: 0 };
  if (courses.length === 0) return none;

  const now = new Date();
  const result = await dashboardCounts(uid, now, weekRange(now).end);
  const c = result.counts;
  return { ...c, total: c.pending + c.in_progress + c.submitted + c.overdue };
}

async function load(user) {
  showView("loading");
  uid = user.uid;
  try {
    if (DEMO) {
      const demo = demoData(DEMO);
      courses = demo.courses;
      const all = toItems(courses, demo.assignments);
      counts = countsFrom(all);
      pool = all;
      source = localSource(all);
    } else {
      courses = await fetchCourses(uid);
      counts = await loadCounts();
      pool = null;
      poolPromise = null;
      source = serverSource();
    }

    filter = rememberedFilter();
    query = "";
    paintChips();

    // With no courses or no assignments there is nothing to list, so we do not ask for any rows
    if (courses.length > 0 && counts.total > 0) {
      const page = await source.reset(filter);
      items = page.items;
      hasMore = page.hasMore;
    } else {
      items = [];
      hasMore = false;
    }
    itemsFilter = filter;

    drawHeader();
    drawList();
    showView("page");
  } catch (err) {
    console.error("Could not load the assignments:", err);
    showView("error");
  }
}

/* ---------- Start ---------- */
startApp("assignments", (user) => {
  // The wide search box is on this page too, and searches every course
  const searchBar = $("topbar-search");
  const searchBtn = $("search-icon-btn");
  if (searchBar) searchBar.hidden = false;
  if (searchBtn) searchBtn.hidden = true;

  const searchInput = $("global-search");
  if (searchInput) {
    searchInput.addEventListener("input", async () => {
      query = searchInput.value;
      sync();
      if (isSearching() && !pool) {
        await ensurePool();
        if (isSearching()) drawList(); // now with everything loaded
      }
    });
  }

  chipButtons.forEach((chipButton) => {
    chipButton.addEventListener("click", () => {
      filter = chipButton.dataset.filter;
      rememberFilter(filter);
      paintChips();
      sync();
    });
  });

  moreBtn.addEventListener("click", showMore);

  // Coming back from the Add Assignment page or after deleting one
  const back = new URLSearchParams(window.location.search);
  if (back.get("added") === "1" || back.get("deleted") === "1") {
    const notice = reminderNotice(back.get("reminders"));
    showToast((back.get("deleted") === "1" ? "Assignment deleted" : "Assignment added") + (notice ? ". " + notice : ""));
    window.history.replaceState(null, "", window.location.pathname);
  }
  $("as-retry").addEventListener("click", () => load(user));
  load(user);
}, { searchBar: true });
