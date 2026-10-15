/* ==========================================================
   TRACKLY calendar month logic (pure, no browser, tested without one)
   Builds the 6 week grid, groups assignments by the day they are due, and works out what the
   arrow keys, the Previous and Next buttons and the side panel title should do.
   All dates are the device's own days. A "month" is 0 to 11 like JavaScript, so October is 9.
   ========================================================== */

import { effectiveStatus, toDate } from "./assignments.js";

const pad = (n) => String(n).padStart(2, "0");

export const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/* "2026-10-13": the key of a day */
export const dayKey = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());

export function dateFromKey(key) {
  const [y, m, d] = String(key).split("-").map(Number);
  return new Date(y, m - 1, d);
}

/* 42 days, Sunday first, always six full weeks: the days of the month plus the spill over days around it */
export function buildMonthGrid(year, month) {
  const first = new Date(year, month, 1);
  const start = addDays(first, -first.getDay());
  return Array.from({ length: 42 }, (_, i) => {
    const date = addDays(start, i);
    return { date, key: dayKey(date), inMonth: date.getMonth() === month && date.getFullYear() === year };
  });
}

/* The dates to read from Firestore for what is on screen: from the first cell up to (not including) the day after the last */
export function gridRange(year, month) {
  const grid = buildMonthGrid(year, month);
  return { start: grid[0].date, end: addDays(grid[41].date, 1) };
}

export function monthLabel(year, month) {
  return new Date(year, month, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

/* Previous or next month, keeping the same day number where possible (31 Jan then Next gives 28 Feb) */
export function shiftMonth(year, month, day, delta) {
  const target = new Date(year, month + delta, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return new Date(target.getFullYear(), target.getMonth(), Math.min(day, lastDay));
}

/* Arrow keys move by a day or a week. PageUp and PageDown change month. Anything else gives null. */
export function moveSelection(date, key) {
  if (key === "ArrowLeft") return addDays(date, -1);
  if (key === "ArrowRight") return addDays(date, 1);
  if (key === "ArrowUp") return addDays(date, -7);
  if (key === "ArrowDown") return addDays(date, 7);
  if (key === "PageUp") return shiftMonth(date.getFullYear(), date.getMonth(), date.getDate(), -1);
  if (key === "PageDown") return shiftMonth(date.getFullYear(), date.getMonth(), date.getDate(), 1);
  return null;
}

/* Map of day key to that day's assignments, earliest first. Each one gets its due date and its real status
   (Overdue is worked out from the due time, never saved). Assignments without a due date are skipped. */
export function groupByDay(items, now = new Date()) {
  const map = new Map();
  items.forEach((item) => {
    const due = toDate(item.dueAt);
    if (!due) return;
    const key = dayKey(due);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push({ ...item, due, status: effectiveStatus(item, now) });
  });
  map.forEach((list) => list.sort((a, b) => a.due - b.due || String(a.title).localeCompare(String(b.title))));
  return map;
}

/* Up to two chips in a day cell, and how many more there are */
export function chipsFor(list, max = 2) {
  return { shown: list.slice(0, max), more: Math.max(0, list.length - max) };
}

/* "Today's Schedule" for today, otherwise "Friday's Schedule" */
export function sideTitle(date, today) {
  return sameDay(date, today) ? "Today\u2019s Schedule" : date.toLocaleDateString("en-US", { weekday: "long" }) + "\u2019s Schedule";
}

/* "Tuesday, Oct 13" */
export function sideDate(date) {
  return date.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
}

/* What a screen reader says for a day button */
export function dayAria(date, count) {
  const label = date.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
  return label + ", " + (count ? count + (count === 1 ? " assignment" : " assignments") : "nothing due");
}

export const STATUS_CLASS = { pending: "cal-pending", in_progress: "cal-progress", overdue: "cal-overdue", submitted: "cal-submitted" };
export const ITEM_CLASS = { pending: "cal-item-pending", in_progress: "cal-item-progress", overdue: "cal-item-overdue", submitted: "cal-item-submitted" };
export const PILL_CLASS = { pending: "pill pill-pending", in_progress: "pill pill-progress", overdue: "pill pill-overdue", submitted: "pill pill-submitted" };