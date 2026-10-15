/* ==========================================================
   TRACKLY course page
   Opens from the View link on a course card: course.html?id=THE_COURSE_ID
   Shows ONE course and only that course's assignments, 20 at a time.

   To keep Firestore reads low, the page does NOT download every assignment:
     - the numbers (total, open, pace) come from two count questions
     - the list loads one page of 20 for the chosen chip, and "Show more" loads the next 20
     - searching loads up to 200 of this course's assignments once, then filters them on the device

   Try the design with sample data (nothing is saved):
     course.html?demo=1          a course with 12 assignments
     course.html?demo=many       a course with 45 assignments (to try Show more)
     course.html?demo=empty      a course with no assignments yet
     course.html?demo=notfound   the "course not found" screen
   ========================================================== */

import { startApp, icon, showToast } from "./shell.js";
import { fetchCourse } from "./courses-data.js";
import { courseCounts, createPager, searchPool } from "./assignments-data.js";
import { headerImage } from "./images.js";
import { buildCourseModel, filterCourseItems, toItems, dueWithDay, STATUS_LABELS } from "./assignments.js";
import { courseChipLabel } from "./course-labels.js";
import { el, plural, safeColor } from "./ui.js";
import { stripMarkdown } from "./markdown.js";
import { reminderNotice } from "./calendar-sync.js";

const PAGE_SIZE = 20;

const params = new URLSearchParams(window.location.search);
const DEMO = params.get("demo");
const COURSE_ID = params.get("id");

const $ = (id) => document.getElementById(id);
const views = {
  loading: $("course-loading"),
  course: $("course-page"),
  notfound: $("course-notfound"),
  error: $("course-error")
};
const list = $("task-list");
const emptyBox = $("task-empty");
const noMatchBox = $("task-nomatch");
const moreBtn = $("show-more");

const PILL_CLASS = {
  pending: "pill pill-pending",
  in_progress: "pill pill-progress",
  overdue: "pill pill-overdue",
  submitted: "pill pill-submitted"
};

let uid = "";
let course = null;
let counts = { total: 0, open: 0, submitted: 0 };
let filter = "all";
let query = "";
let items = [];         // the rows loaded so far, for itemsFilter
let itemsFilter = "all";
let hasMore = false;
let loadingMore = false;
let source = null;      // gives pages of rows: from Firestore, or from sample data
let token = 0;          // lets us ignore answers that arrive late
let pool = null;        // up to 200 of this course's assignments, for searching
let poolPromise = null;

/* ---------- Which of the four things to show ---------- */
function showView(name) {
  Object.keys(views).forEach((key) => { views[key].hidden = key !== name; });
}

/* ---------- Where the rows come from ---------- */

/* Real data: one page of 20 at a time from Firestore */
function serverSource(userId, courseId) {
  let pager = null;
  const toRows = (page) => ({ items: toItems([course], page.items), hasMore: page.hasMore });
  return {
    async reset(chip) {
      pager = createPager(userId, chip, new Date(), courseId, PAGE_SIZE);
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
      rows = filterCourseItems(all, chip, "");
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

function taskRow(item) {
  const li = el("li", "task");

  const link = el("a", "task-link");
  link.href = "assignment.html?id=" + encodeURIComponent(item.id);

  const chip = el("span", "task-chip", courseChipLabel(course));
  chip.title = course.title || "";

  const title = el("p", "task-title", item.title);
  title.title = item.title;
  const text = el("div", "task-text");
  text.append(title);
  if (item.description) {
    const plainNotes = stripMarkdown(item.description);
    const desc = el("p", "task-desc", plainNotes);
    desc.title = plainNotes;
    text.append(desc);
  }

  const main = el("div", "task-main");
  main.append(chip, text);

  const due = el("span", "task-due");
  due.append(iconSpan("calendar"), document.createTextNode(item.due ? "Due " + dueWithDay(item.due) : "No due date"));

  const side = el("div", "task-side");
  side.append(due, el("span", PILL_CLASS[item.status], STATUS_LABELS[item.status]), iconSpan("chevron", "task-go"));

  link.append(main, side);
  li.append(link);
  return li;
}

/* ---------- The course ---------- */
function drawCourse() {
  const id = encodeURIComponent(course.id);

  document.title = (course.title || "Course") + " | Trackly";
  views.course.style.setProperty("--course-color", safeColor(course.color));

  $("course-title").textContent = course.title || "Untitled course";
  const sub = [course.code, course.instructor].filter(Boolean).join(" \u00B7 ");
  $("course-sub").textContent = sub;
  $("course-sub").hidden = !sub;

  // The banner: the course photo, or a wash of the course color when there is none
  const banner = $("course-banner-img");
  const src = headerImage(course.imageUrl, 1200, 200);
  banner.hidden = !src;
  if (src) {
    banner.onerror = () => { banner.hidden = true; };
    banner.src = src;
  }

  $("new-assignment").href = "add-assignment.html?course=" + id;
  $("new-assignment-empty").href = "add-assignment.html?course=" + id;
  $("edit-course").href = "edit-course.html?id=" + id;

  $("info-code").textContent = course.code || "Not set";
  $("info-instructor").textContent = course.instructor || "Not set";
  $("info-assignments").textContent = counts.total + " total \u00B7 " + counts.open + " due";

  // Academic Pace: only this course's assignments, submitted divided by total
  const percent = counts.total ? Math.round((counts.submitted / counts.total) * 100) : 0;
  $("pace-value").textContent = counts.total ? percent + "% on track" : "No data yet";
  $("pace-bar").setAttribute("aria-valuenow", String(percent));
  $("pace-bar").firstElementChild.style.width = percent + "%";
  $("pace-note").textContent = counts.total
    ? counts.submitted + " of " + plural(counts.total, "assignment") + " submitted across the semester."
    : "Add an assignment to see your pace.";

  $("open-count").textContent = counts.open === 0 ? "No open tasks" : plural(counts.open, "open task");
}

/* ---------- The list ---------- */
const isSearching = () => query.trim() !== "";

function visibleRows() {
  if (!isSearching()) return items;
  // While the 200 are still loading, search what is already on screen
  return filterCourseItems(pool || items, filter, query);
}

function drawList() {
  const rows = visibleRows();
  list.replaceChildren();
  rows.forEach((item) => list.append(taskRow(item)));

  list.hidden = rows.length === 0;
  emptyBox.hidden = counts.total !== 0;
  noMatchBox.hidden = !(counts.total > 0 && rows.length === 0);

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

/* The first search loads up to 200 of this course's assignments, once */
function ensurePool() {
  if (pool) return Promise.resolve(pool);
  if (!poolPromise) {
    poolPromise = searchPool(uid, course.id, 200)
      .then((raw) => { pool = buildCourseModel(course.id, raw).items; return pool; })
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
  if (kind === "notfound") return null;

  const demoCourse = { id: "demo", title: "Introduction to Biology", code: "BIO 101", instructor: "Dr. Smith", color: "#00D996" };
  if (kind === "empty") return { course: demoCourse, assignments: [] };

  const at = (days, hour = 23, minute = 59) => {
    const d = new Date(Date.now() + days * 86400000);
    d.setHours(hour, minute, 0, 0);
    return d;
  };
  const a = (title, description, dueAt, status) => ({ id: "d-" + title, courseId: "demo", title, description, dueAt, status });
  const assignments = [
    a("Chapter 5 Essay", "Mendelian Genetics & Inheritance Patterns", at(2), "in_progress"),
    a("Cell Structure Lab Report", "Eukaryotic vs. Prokaryotic Organelles", at(-7), "pending"), // becomes Overdue
    a("Midterm Study Guide", "Modules 1-4 Comprehensive Review", at(14), "pending"),
    a("Genetics Worksheet and a Very Long Title That Should Be Cut Off With Three Dots", "Punnett squares and the probability of inherited traits across several generations", at(-3), "submitted"),
    a("Lab Safety Quiz", "Equipment, hazards and procedures", at(-30), "submitted"),
    a("Scientific Method Worksheet", "Hypotheses, variables and controls", at(-27), "submitted"),
    a("Cell Theory Notes", "History and principles of cell theory", at(-24), "submitted"),
    a("Microscope Lab", "Using and caring for a compound microscope", at(-21), "submitted"),
    a("Photosynthesis Quiz", "Light reactions and the Calvin cycle", at(-18), "submitted"),
    a("DNA Structure Diagram", "Label the parts of a DNA molecule", at(-14), "submitted"),
    a("Ecosystems Essay", "Energy flow and food webs", at(-10), "submitted"),
    a("Evolution Reading Response", "Natural selection in practice", at(-6), "submitted")
  ];

  // demo=many: 33 more, so there is more than one page
  if (kind === "many") {
    for (let i = 1; i <= 33; i += 1) {
      const status = i % 3 === 0 ? "pending" : i % 3 === 1 ? "in_progress" : "submitted";
      assignments.push(a("Practice Set " + i, "Extra practice problems, set " + i, at(i % 3 === 2 ? -(i + 40) : i + 2), status));
    }
  }
  return { course: demoCourse, assignments };
}

/* ---------- Loading ---------- */
async function load(user) {
  showView("loading");
  uid = user.uid;
  try {
    let found;

    if (DEMO) {
      const demo = demoData(DEMO);
      if (!demo) {
        showView("notfound");
        return;
      }
      found = demo.course;
      const model = buildCourseModel(found.id, demo.assignments);
      counts = { total: model.total, open: model.openCount, submitted: model.counts.submitted };
      pool = model.items;
      source = localSource(model.items);
    } else {
      found = await fetchCourse(uid, COURSE_ID);
      if (!found) {
        showView("notfound");
        return;
      }
      counts = await courseCounts(uid, found.id);
      pool = null;
      poolPromise = null;
      source = serverSource(uid, found.id);
    }

    course = found;
    filter = "all";
    query = "";
    document.querySelectorAll(".filter-chip").forEach((chip) => {
      chip.setAttribute("aria-pressed", String(chip.dataset.filter === "all"));
    });

    const page = await source.reset("all");
    items = page.items;
    hasMore = page.hasMore;
    itemsFilter = "all";

    drawCourse();
    drawList();
    showView("course");

    // Coming back from the Add Assignment page
    if (params.get("added") === "1") {
      const notice = reminderNotice(params.get("reminders"));
      showToast("Assignment added" + (notice ? ". " + notice : ""));
      const addedUrl = new URL(window.location.href);
      addedUrl.searchParams.delete("added");
      addedUrl.searchParams.delete("reminders");
      window.history.replaceState(null, "", addedUrl);
    }

    // Coming back from the Edit Course page
    if (params.get("saved") === "1") {
      showToast("Changes saved");
      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete("saved");
      window.history.replaceState(null, "", cleanUrl);
    }
  } catch (err) {
    console.error("Could not load the course:", err);
    showView("error");
  }
}

/* ---------- Start ---------- */
startApp("courses", (user) => {
  // The wide search box is on course pages too, and filters this course's assignments
  const searchBar = $("topbar-search");
  const searchBtn = $("search-icon-btn");
  if (searchBar) searchBar.hidden = false;
  if (searchBtn) searchBtn.hidden = true;

  const searchInput = $("global-search");
  if (searchInput) {
    searchInput.placeholder = "Search this course's assignments...";
    searchInput.addEventListener("input", async () => {
      query = searchInput.value;
      sync();
      if (isSearching() && course && !pool) {
        await ensurePool();
        if (isSearching()) drawList(); // now with everything loaded
      }
    });
  }

  document.querySelectorAll(".filter-chip").forEach((chipButton) => {
    chipButton.addEventListener("click", () => {
      filter = chipButton.dataset.filter;
      document.querySelectorAll(".filter-chip").forEach((other) => {
        other.setAttribute("aria-pressed", String(other === chipButton));
      });
      if (course) sync();
    });
  });

  moreBtn.addEventListener("click", showMore);
  $("course-retry").addEventListener("click", () => load(user));
  load(user);
}, { searchBar: true });