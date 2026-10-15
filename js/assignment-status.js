/* ==========================================================
   TRACKLY assignment page rules (pure logic, tested without a browser)
   What happens when the student taps a status, who may edit, and the wording on the page.
   Overdue is never saved: it comes from assignments.js (effectiveStatus).
   Times are the device's own.
   ========================================================== */

import { effectiveStatus, toDate } from "./assignments.js";

export const SETTABLE = ["pending", "in_progress", "submitted"];

/* What to save for a status tap, or null if nothing changes.
   Markers: "now" means save the server time, "clear" means remove the field. */
export function statusChange(assignment, next) {
  if (!SETTABLE.includes(next) || assignment.status === next) return null;
  const change = { status: next };
  if (next === "in_progress" && !assignment.startedAt) change.startedAt = "now";
  if (next === "submitted") change.submittedAt = "now";
  if (assignment.status === "submitted" && next !== "submitted") change.submittedAt = "clear";
  return change;
}

/* Overdue and Submitted assignments cannot be edited */
export function editRule(assignment, now = new Date()) {
  const status = effectiveStatus(assignment, now);
  if (status === "overdue") return { ok: false, reason: "Overdue assignments cannot be edited." };
  if (status === "submitted") return { ok: false, reason: "Submitted assignments cannot be edited." };
  return { ok: true, reason: "" };
}

/* "4:12 PM" with a normal space */
function clock(date) {
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).replace(/\u202f/g, " ");
}

export function zoneLabel(date) {
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZoneName: "short" }).formatToParts(date)
      .find((p) => p.type === "timeZoneName");
    return part ? part.value : "";
  } catch (err) {
    return "";
  }
}

const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/* "Friday, Oct 24", with the year when it is not this year */
export function dueDateText(date, now = new Date()) {
  if (!date) return "No due date";
  const opts = { weekday: "long", month: "short", day: "numeric" };
  if (date.getFullYear() !== now.getFullYear()) opts.year = "numeric";
  return date.toLocaleDateString("en-US", opts);
}

/* "11:59 PM WAT" */
export function dueTimeText(date) {
  if (!date) return "";
  const zone = zoneLabel(date);
  return clock(date) + (zone ? " " + zone : "");
}

/* "Oct 12, 2026" */
export function createdText(date) {
  return date ? date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
}

/* "Last modified today at 4:12 PM" */
export function modifiedText(date, now = new Date()) {
  if (!date) return "";
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (sameDay(date, now)) return "Last modified today at " + clock(date);
  if (sameDay(date, yesterday)) return "Last modified yesterday at " + clock(date);
  return "Last modified on " + createdText(date) + " at " + clock(date);
}

/* "Unit 2 • Cell Biology", one of them, or "" */
export function unitTopicText(a) {
  return [a.unit, a.topic].filter(Boolean).join(" \u2022 ");
}

export const PRIORITY_LABELS = { low: "Low", medium: "Medium", high: "High" };

/* Date and time boxes of the form, from a saved due date */
export function dueToInputs(value) {
  const d = toDate(value);
  if (!d) return { date: "", time: "" };
  const pad = (n) => String(n).padStart(2, "0");
  return { date: d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()), time: pad(d.getHours()) + ":" + pad(d.getMinutes()) };
}