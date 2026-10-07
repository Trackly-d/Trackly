/* ==========================================================
   TRACKLY course page
   Opens from the View link on a course card: course.html?id=THE_COURSE_ID
   Shows ONE course and only that course's assignments.

   Try the design with sample data (nothing is saved):
     course.html?demo=1          a course with 12 assignments
     course.html?demo=empty      a course with no assignments yet
     course.html?demo=notfound   the "course not found" screen
   ========================================================== */

import { startApp, icon, showToast } from "./shell.js";
import { fetchCourse, fetchAssignments } from "./courses-data.js";
import { headerImage } from "./images.js";
import { buildCourseModel, filterCourseItems, shortDate, STATUS_LABELS } from "./assignments.js";
import { courseChipLabel } from "./course-labels.js";
import { el, plural, safeColor } from "./ui.js";

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

const PILL_CLASS = {
  pending: "pill pill-pending",
  in_progress: "pill pill-progress",
  overdue: "pill pill-overdue",
  submitted: "pill pill-submitted"
};

let course = null;
let model = null;
let filter = "all";
let query = "";

/* ---------- Which of the four things to show ---------- */
function showView(name) {
  Object.keys(views).forEach((key) => { views[key].hidden = key !== name; });
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
  link.setAttribute("data-soon", ""); // delete this line when the assignment page is built

  const chip = el("span", "task-chip", courseChipLabel(course));
  chip.title = course.title || "";

  const title = el("p", "task-title", item.title);
  title.title = item.title;
  const text = el("div", "task-text");
  text.append(title);
  if (item.description) {
    const desc = el("p", "task-desc", item.description);
    desc.title = item.description;
    text.append(desc);
  }

  const main = el("div", "task-main");
  main.append(chip, text);

  const due = el("span", "task-due");
  due.append(iconSpan("calendar"), document.createTextNode(item.due ? "Due " + shortDate(item.due) : "No due date"));

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
  $("info-assignments").textContent = model.total + " total \u00B7 " + model.openCount + " due";

  // Academic Pace: only this course's assignments, submitted divided by total
  const { done, total, percent } = model.pace;
  $("pace-value").textContent = total ? percent + "% on track" : "No data yet";
  $("pace-bar").setAttribute("aria-valuenow", String(percent));
  $("pace-bar").firstElementChild.style.width = percent + "%";
  $("pace-note").textContent = total
    ? done + " of " + plural(total, "assignment") + " submitted across the semester."
    : "Add an assignment to see your pace.";

  $("open-count").textContent = model.openCount === 0 ? "No open tasks" : plural(model.openCount, "open task");
}

function drawList() {
  const rows = filterCourseItems(model.items, filter, query);
  list.replaceChildren();
  rows.forEach((item) => list.append(taskRow(item)));

  list.hidden = rows.length === 0;
  emptyBox.hidden = model.items.length !== 0;
  noMatchBox.hidden = !(model.items.length > 0 && rows.length === 0);
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
  const a = (title, description, dueAt, status) => ({ courseId: "demo", title, description, dueAt, status });
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
  return { course: demoCourse, assignments };
}

/* ---------- Loading ---------- */
async function load(user) {
  showView("loading");
  try {
    let loaded;
    if (DEMO) {
      loaded = demoData(DEMO);
    } else {
      const found = await fetchCourse(user.uid, COURSE_ID);
      loaded = found ? { course: found, assignments: await fetchAssignments(user.uid) } : null;
    }

    if (!loaded) {
      showView("notfound");
      return;
    }

    course = loaded.course;
    model = buildCourseModel(course.id, loaded.assignments);
    drawCourse();
    drawList();
    showView("course");

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
    searchInput.addEventListener("input", () => {
      query = searchInput.value;
      if (model) drawList();
    });
  }

  document.querySelectorAll(".filter-chip").forEach((chipButton) => {
    chipButton.addEventListener("click", () => {
      filter = chipButton.dataset.filter;
      document.querySelectorAll(".filter-chip").forEach((other) => {
        other.setAttribute("aria-pressed", String(other === chipButton));
      });
      if (model) drawList();
    });
  });

  $("course-retry").addEventListener("click", () => load(user));
  load(user);
}, { searchBar: true });