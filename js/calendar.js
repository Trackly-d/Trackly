/* ==========================================================
   TRACKLY Calendar page
   A month grid of the student's assignments by due date, and a panel for the chosen day.

   Reads: one query for what is on screen (the 6 weeks of the grid, up to 200 assignments,
   remembered for a minute) plus the courses (remembered too). Nothing is written.
   Colors are the same as the status pills. Overdue is worked out from the due time, never saved.
   Nothing about the student is kept in the browser.

   Mouse or touch: tap a day to choose it. Tapping a faded day from a neighbouring month jumps to that month.
   Keyboard: arrow keys move by a day or a week, PageUp and PageDown change month.

   Design views (no data is read):  calendar.html?state=loading | ?state=error
   ========================================================== */

import { startApp, showToast } from "./shell.js";
import { fetchAssignmentsInRange } from "./assignments-data.js";
import { fetchCourses } from "./courses-data.js";
import { el } from "./ui.js";
import { dueTimeText } from "./assignment-status.js";
import { courseChipLabel } from "./course-labels.js";
import { STATUS_LABELS } from "./assignments.js";
import {
  buildMonthGrid, gridRange, monthLabel, shiftMonth, moveSelection, groupByDay, chipsFor,
  sideTitle, sideDate, dayAria, dayKey, dateFromKey, sameDay,
  STATUS_CLASS, ITEM_CLASS, PILL_CLASS
} from "./calendar-month.js";

const STATE = new URLSearchParams(window.location.search).get("state");
const $ = (id) => document.getElementById(id);
const views = { loading: $("cal-loading"), error: $("cal-error"), page: $("cal-page") };
const grid = $("cal-grid");

let uid = "";
let courses = new Map();   // course id to course
let view = { year: 0, month: 0 };
let selected = new Date(); // the chosen day
let byDay = new Map();     // day key to that day's assignments
let busy = false;
let wantFocus = false;

function show(name) {
  Object.keys(views).forEach((key) => { views[key].hidden = key !== name; });
}

/* ---------- Drawing ---------- */
function clockIcon() {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("class", "icon");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  const circle = document.createElementNS(ns, "circle");
  circle.setAttribute("cx", "12"); circle.setAttribute("cy", "12"); circle.setAttribute("r", "10");
  const hands = document.createElementNS(ns, "polyline");
  hands.setAttribute("points", "12 6 12 12 16 14");
  svg.append(circle, hands);
  return svg;
}

function dayButton(cell, today) {
  const list = byDay.get(cell.key) || [];
  const isSelected = sameDay(cell.date, selected);
  let cls = "cal-day";
  if (!cell.inMonth) cls += " is-other";
  if (sameDay(cell.date, today)) cls += " is-today";
  if (isSelected) cls += " is-selected";

  const button = el("button", cls);
  button.type = "button";
  button.dataset.key = cell.key;
  button.setAttribute("aria-label", dayAria(cell.date, list.length));
  button.setAttribute("aria-pressed", String(isSelected));
  button.tabIndex = isSelected ? 0 : -1; // one stop for the keyboard, arrows do the rest
  button.append(el("span", "cal-num", String(cell.date.getDate())));

  if (list.length) {
    const { shown, more } = chipsFor(list);
    const chips = el("span", "cal-chips");
    shown.forEach((item) => {
      const chip = el("span", "cal-chip " + STATUS_CLASS[item.status]);
      chip.title = item.title;
      chip.append(el("span", "cal-chip-text", item.title));
      chips.append(chip);
    });
    if (more) chips.append(el("span", "cal-more", "+" + more + " more"));
    button.append(chips);
  }
  return button;
}

function sideItem(item) {
  const li = el("li");
  const link = el("a", "cal-item " + ITEM_CLASS[item.status]);
  link.href = "assignment.html?id=" + encodeURIComponent(item.id);

  const top = el("span", "cal-item-top");
  top.append(el("span", "cal-course", courseChipLabel(courses.get(item.courseId))));
  top.append(el("span", PILL_CLASS[item.status], STATUS_LABELS[item.status]));

  const time = el("span", "cal-item-time");
  time.append(clockIcon(), document.createTextNode(" " + dueTimeText(item.due)));

  link.append(top, el("span", "cal-item-title", item.title), time);
  li.append(link);
  return li;
}

function render() {
  const today = new Date();
  const cells = buildMonthGrid(view.year, view.month);

  $("cal-month").textContent = monthLabel(view.year, view.month);
  grid.setAttribute("aria-label", monthLabel(view.year, view.month));
  grid.replaceChildren(...cells.map((cell) => dayButton(cell, today)));

  // Nothing due anywhere in this month's own days
  $("cal-empty").hidden = cells.some((cell) => cell.inMonth && byDay.has(cell.key));

  const list = byDay.get(dayKey(selected)) || [];
  $("cal-side-title").textContent = sideTitle(selected, today);
  $("cal-side-date").textContent = sideDate(selected);
  $("cal-list").replaceChildren(...list.map(sideItem));
  $("cal-list").hidden = list.length === 0;
  $("cal-side-empty").hidden = list.length > 0;

  if (wantFocus) {
    const chosen = grid.querySelector(".is-selected");
    if (chosen) chosen.focus();
    wantFocus = false;
  }
}

/* ---------- Loading a month ---------- */
async function readMonth(year, month) {
  const { start, end } = gridRange(year, month);
  const data = await fetchAssignmentsInRange(uid, start, end);
  if (data.truncated) showToast("This view has a lot of assignments, so only the first 200 are shown.");
  return groupByDay(data.items, new Date());
}

/* Goes to a day. If it is in another month, that month is read first, and the old one stays until it arrives. */
async function goTo(date, { focus = false } = {}) {
  if (busy) return;
  wantFocus = focus;
  const sameMonth = date.getFullYear() === view.year && date.getMonth() === view.month;
  if (sameMonth) { selected = date; render(); return; }

  busy = true;
  grid.setAttribute("aria-busy", "true");
  try {
    byDay = await readMonth(date.getFullYear(), date.getMonth());
    view = { year: date.getFullYear(), month: date.getMonth() };
    selected = date;
    render();
  } catch (err) {
    console.error("Could not load that month:", err);
    showToast("Could not load that month. Check your connection and try again.");
    wantFocus = false;
  }
  grid.removeAttribute("aria-busy");
  busy = false;
}

async function load() {
  show("loading");
  try {
    const list = await fetchCourses(uid).catch((err) => { console.error("Could not load the courses:", err); return []; }); // tags fall back to "No course"
    courses = new Map(list.map((course) => [course.id, course]));
    const today = new Date();
    view = { year: today.getFullYear(), month: today.getMonth() };
    selected = today;
    byDay = await readMonth(view.year, view.month);
  } catch (err) {
    console.error("Could not load the calendar:", err);
    show("error");
    return;
  }
  render();
  show("page");
}

/* ---------- Start ---------- */
function init(user) {
  uid = user.uid;

  // Design review views, no data is read
  if (views[STATE] && STATE !== "page") { show(STATE); return; }

  $("cal-prev").addEventListener("click", () => goTo(shiftMonth(view.year, view.month, selected.getDate(), -1)));
  $("cal-next").addEventListener("click", () => goTo(shiftMonth(view.year, view.month, selected.getDate(), 1)));
  $("cal-today").addEventListener("click", () => goTo(new Date()));
  $("cal-retry").addEventListener("click", load);

  grid.addEventListener("click", (event) => {
    const button = event.target.closest(".cal-day");
    if (button) goTo(dateFromKey(button.dataset.key));
  });
  grid.addEventListener("keydown", (event) => {
    const next = moveSelection(selected, event.key);
    if (!next) return;
    event.preventDefault();
    goTo(next, { focus: true });
  });

  load();
}

startApp("calendar", init);