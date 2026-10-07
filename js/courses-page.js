/* ==========================================================
   TRACKLY My Courses page
   Loads the student's courses and assignments, then draws the summary
   numbers and the course cards.

   Try the design with sample courses (nothing is saved):
     courses.html?demo=1
   ========================================================== */

import { startApp, icon, showToast } from "./shell.js";
import { fetchCourses, fetchAssignments } from "./courses-data.js";
import { headerImage } from "./images.js";
import { toDate, dayLabel, deadlineText, effectiveStatus } from "./assignments.js";

/* The small pill next to the title, for example "Spring 2025".
   Hidden while empty. The team still has to decide how a term is chosen. */
const TERM_LABEL = "";

const DEMO = new URLSearchParams(window.location.search).get("demo") === "1";
const DEFAULT_COLOR = "#00D996";

const grid = document.getElementById("course-grid");
const subtitle = document.getElementById("courses-sub");
const termPill = document.getElementById("term-pill");
const filterInput = document.getElementById("course-filter");
const noMatch = document.getElementById("no-match");
const errorBox = document.getElementById("courses-error");
const retryBtn = document.getElementById("retry-btn");

/* ---------- Small helpers ---------- */

/* Builds an element. Text is added with textContent, so nothing a student types can run as code. */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function iconSpan(name) {
  const span = el("span", "icon-wrap");
  span.setAttribute("aria-hidden", "true");
  span.innerHTML = icon(name); // fixed icon markup from shell.js, not student text
  return span;
}

function plural(count, word) {
  return count + " " + word + (count === 1 ? "" : "s");
}

function safeColor(value) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : DEFAULT_COLOR;
}

/* ---------- Working out the numbers ---------- */
function summarize(courses, assignments) {
  const now = new Date();
  const perCourse = new Map(courses.map((c) => [c.id, { total: 0, pending: 0, next: null }]));
  let pendingAll = 0; // not submitted yet (pending, in progress or overdue)
  let doneAll = 0;
  let overdueAll = 0;
  let nextAll = null;

  assignments.forEach((a) => {
    const stat = perCourse.get(a.courseId);
    if (!stat) return; // belongs to a course that no longer exists
    const status = effectiveStatus(a, now);
    const due = toDate(a.dueAt);
    stat.total += 1;
    if (status === "submitted") {
      doneAll += 1;
      return;
    }
    stat.pending += 1;
    pendingAll += 1;
    if (status === "overdue") overdueAll += 1;
    if (due) {
      if (!stat.next || due < stat.next) stat.next = due;
      if (status !== "overdue" && (!nextAll || due < nextAll)) nextAll = due;
    }
  });

  return { now, perCourse, pendingAll, doneAll, overdueAll, nextAll };
}

function drawSummary(courses, s) {
  subtitle.textContent = plural(courses.length, "course") + " \u00B7 " + s.pendingAll + " active " + (s.pendingAll === 1 ? "assignment" : "assignments");

  document.getElementById("stat-total").textContent = s.pendingAll + " remaining";

  document.getElementById("stat-next").textContent = s.nextAll
    ? deadlineText(s.nextAll, s.now)
    : (s.overdueAll > 0 ? "Overdue tasks" : "Nothing coming up");

  const all = s.pendingAll + s.doneAll;
  document.getElementById("stat-completion").textContent = all ? Math.round((s.doneAll / all) * 100) + "%" : "\u2014";

  // A simple rule for now: any overdue assignment means the student is behind
  document.getElementById("stat-pace").textContent = s.overdueAll > 0 ? "Behind" : "On Track";
}

/* ---------- Drawing the cards ---------- */
function badge(stat) {
  if (stat.pending > 0) return el("span", "badge badge-due", stat.pending + " due");
  if (stat.total > 0) {
    const ok = el("span", "badge badge-ok");
    ok.append(iconSpan("checkCircle"), document.createTextNode("All caught up"));
    return ok;
  }
  return el("span", "badge badge-none", "No assignments yet");
}

function footerLeft(stat, now) {
  const left = el("span", "course-next");
  if (stat.pending > 0) {
    const label = stat.next ? dayLabel(stat.next, now) : "No date set";
    const strong = el("strong", "", label);
    left.append(iconSpan("calendar"), document.createTextNode("Next due: "), strong);
  } else if (stat.total > 0) {
    left.append(iconSpan("checkCircle"), document.createTextNode("No pending tasks"));
  } else {
    left.append(iconSpan("calendar"), document.createTextNode("No assignments yet"));
  }
  return left;
}

function courseCard(course, stat, now) {
  const card = el("article", "course-card");
  card.style.setProperty("--course-color", safeColor(course.color));
  card.dataset.search = [course.title, course.code, course.instructor].join(" ").toLowerCase();

  const photo = el("div", "course-photo");
  const src = headerImage(course.imageUrl);
  if (src) {
    const img = document.createElement("img");
    img.src = src;
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    img.addEventListener("error", () => img.remove()); // falls back to the colored header
    photo.append(img);
  }

  const body = el("div", "course-body");

  const meta = el("div", "course-meta");
  meta.append(el("span", "course-code", course.code || ""), badge(stat));

  body.append(meta, el("h2", "course-title", course.title || "Untitled course"));

  if (course.instructor) {
    const row = el("p", "course-instructor");
    row.append(iconSpan("user"), document.createTextNode(course.instructor));
    body.append(row);
  }

  const chips = [course.location, course.credits].filter(Boolean);
  if (chips.length) {
    const chipRow = el("div", "chip-row");
    chips.forEach((text) => chipRow.append(el("span", "chip", text)));
    body.append(chipRow);
  }

  const foot = el("div", "course-foot");
  const view = el("a", "view-link");
  view.href = "course.html?id=" + encodeURIComponent(course.id);
  view.append(document.createTextNode("View"), iconSpan("arrow"));
  foot.append(footerLeft(stat, now), view);
  body.append(foot);

  card.append(photo, body);
  return card;
}

function addTile() {
  const tile = el("a", "add-tile");
  tile.href = "add-course.html";
  const circle = el("span", "add-circle");
  circle.setAttribute("aria-hidden", "true");
  circle.innerHTML = icon("plus");
  tile.append(circle, el("span", "add-text", "Add Courses"));
  return tile;
}

function drawCourses(courses, s) {
  grid.replaceChildren();
  courses.forEach((course) => {
    grid.append(courseCard(course, s.perCourse.get(course.id), s.now));
  });
  grid.append(addTile());
  noMatch.hidden = true;
}

function drawSkeletons() {
  grid.replaceChildren();
  for (let i = 0; i < 3; i += 1) grid.append(el("div", "skeleton-card"));
  grid.setAttribute("aria-busy", "true");
}

/* ---------- Search box ---------- */
filterInput.addEventListener("input", () => {
  const term = filterInput.value.trim().toLowerCase();
  let visible = 0;
  const cards = grid.querySelectorAll(".course-card");
  cards.forEach((card) => {
    const show = !term || card.dataset.search.includes(term);
    card.hidden = !show;
    if (show) visible += 1;
  });
  noMatch.hidden = !(cards.length > 0 && visible === 0);
});

/* ---------- Sample data for ?demo=1 ---------- */
function demoData() {
  const now = Date.now();
  const at = (days) => {
    const d = new Date(now + days * 86400000);
    d.setHours(23, 59, 0, 0);
    return d;
  };
  const courses = [
    { id: "d1", code: "BIO 101", title: "Introduction to Biology", instructor: "Dr. Evelyn Reed", location: "Hall C \u00B7 Rm 204", color: "#00D996" },
    { id: "d2", code: "ECO 201", title: "Microeconomics", instructor: "Prof. Marcus Vance", location: "Social Sci \u00B7 Rm 110", color: "#0E5C4A" },
    { id: "d3", code: "STAT 210", title: "Statistics & Probability", instructor: "Dr. Sarah Lin", location: "Math Wing \u00B7 Rm 402", credits: "4.0 Credits", color: "#3B82F6" },
    { id: "d4", code: "CHEM 220", title: "Organic Chemistry", instructor: "Dr. Aris Thorne", location: "Physical Sci \u00B7 Rm 312", color: "#A855F7" },
    { id: "d5", code: "CS 106", title: "Data Structures & Algorithms", instructor: "Prof. David Miller", location: "Turing Lab \u00B7 Rm 101", color: "#F59E0B" },
    { id: "d6", code: "", title: "A brand new course", color: "#EF4444" }
  ];
  const a = (courseId, dueAt, status) => ({ courseId, dueAt, status: status || "pending" });
  const assignments = [
    a("d1", at(3)), a("d1", at(5)), a("d1", at(6)),
    a("d2", at(4)),
    a("d3", at(-2), "submitted"), a("d3", at(-9), "submitted"),
    a("d4", at(1)), a("d4", at(2)),
    a("d5", at(2)), a("d5", at(3)), a("d5", at(4)), a("d5", at(5)), a("d5", at(6)), a("d5", at(7))
  ];
  return { courses, assignments };
}

/* ---------- Loading ---------- */
async function load(user) {
  errorBox.hidden = true;
  drawSkeletons();
  try {
    const { courses, assignments } = DEMO
      ? demoData()
      : { courses: await fetchCourses(user.uid), assignments: await fetchAssignments(user.uid) };

    // Oldest course first
    courses.sort((x, y) => {
      const a = toDate(x.createdAt);
      const b = toDate(y.createdAt);
      return (a ? a.getTime() : 0) - (b ? b.getTime() : 0);
    });

    const summary = summarize(courses, assignments);
    drawSummary(courses, summary);
    drawCourses(courses, summary);

    // Coming back from the Add Course page
    if (new URLSearchParams(window.location.search).get("added") === "1") {
      showToast("Course added");
      window.history.replaceState(null, "", window.location.pathname);
    }
  } catch (err) {
    console.error("Could not load courses:", err);
    grid.replaceChildren();
    errorBox.hidden = false;
  }
  grid.removeAttribute("aria-busy");
}

if (TERM_LABEL) {
  termPill.textContent = TERM_LABEL;
  termPill.hidden = false;
}

startApp("courses", (user) => {
  retryBtn.addEventListener("click", () => load(user));
  load(user);
});