/* ==========================================================
   TRACKLY notifications logic (pure, no Firebase, tested without a browser)

   Two kinds of notification:
     ALERTS (worked out when the page opens, because nothing runs while Trackly is closed):
       - "due soon": for an open assignment, once a chosen time before the due moment has passed.
         Only the tightest time that has passed is shown, and only times after the assignment was added.
       - "overdue": an open assignment whose due moment has passed (for 30 days).
     ACTIVITY (saved the moment it happens): an assignment was added, started, edited or marked as submitted, or a course was added or edited.
     (Deleting something removes its history straight away, so there is no "deleted" entry.)

   Read state is tiny: "everything before this moment is read" plus a few individually read items.
   All times are milliseconds.
   ========================================================== */

import { toDate } from "./assignments.js";

export const ALERT_HOURS = [3, 24, 48];
export const DEFAULT_ALERT_HOURS = [48, 24];
export const WINDOW_DAYS = 30;
export const PAGE_SIZE = 20;
export const FILTERS = ["all", "unread", "reminders", "overdue", "added", "submitted", "updates", "courses"];
export const ACTIVITY_TYPES = ["added", "submitted", "started", "edited", "course_added", "course_edited"];

const HOUR = 3600000;
const DAY = 24 * HOUR;

/* ---------- Alert settings ---------- */
export function normalizeAlertHours(list) {
  if (!Array.isArray(list)) return DEFAULT_ALERT_HOURS.slice();
  return Array.from(new Set(list.map(Number))).filter((h) => ALERT_HOURS.includes(h)).sort((a, b) => b - a);
}

/* What the Settings page shows, from the student's record */
export function alertSettingsFrom(record) {
  const r = record || {};
  return { alertsEnabled: r.alertsEnabled !== false, alertHours: normalizeAlertHours(r.alertHours) };
}

/* Returns { ok, error, value } */
export function validateAlertSettings({ alertsEnabled, alertHours }) {
  const hours = normalizeAlertHours(alertHours || []);
  if (alertsEnabled && hours.length === 0) return { ok: false, error: "Choose at least one alert time, or turn alerts off.", value: null };
  return { ok: true, error: "", value: { alertsEnabled: Boolean(alertsEnabled), alertHours: hours } };
}

/* ---------- Alerts worked out from assignments ---------- */
function reminderTitle(title, hours) {
  return title + " is due in " + hours + " hours";
}

export function deriveAlerts({ assignments, now, alertHours, windowDays = WINDOW_DAYS }) {
  const nowMs = now instanceof Date ? now.getTime() : now;
  const hours = normalizeAlertHours(alertHours).sort((a, b) => a - b); // smallest first
  const seen = new Set();
  const items = [];

  for (const a of assignments) {
    if (!a || seen.has(a.id)) continue;
    seen.add(a.id);
    if (a.status !== "pending" && a.status !== "in_progress") continue;
    const due = toDate(a.dueAt);
    if (!due) continue;
    const dueMs = due.getTime();

    if (dueMs > nowMs) {
      const created = toDate(a.createdAt);
      const createdMs = created ? created.getTime() : 0;
      // the tightest time that has already passed, but only if it passed after the assignment was added
      const crossed = hours.find((h) => dueMs - h * HOUR <= nowMs && dueMs - h * HOUR >= createdMs);
      if (crossed !== undefined) {
        items.push({ key: a.id + ":reminder:" + crossed + ":" + dueMs, type: "reminder", assignmentId: a.id, title: reminderTitle(a.title, crossed), courseId: a.courseId, time: dueMs - crossed * HOUR });
      }
    } else if (dueMs > nowMs - windowDays * DAY) {
      items.push({ key: a.id + ":overdue:" + dueMs, type: "overdue", assignmentId: a.id, title: a.title + " is overdue", courseId: a.courseId, time: dueMs });
    }
  }
  return items;
}

/* ---------- Activity saved when it happens ---------- */
/* "added" and course_added are saved once per item (a second save would replace the first); every other kind gets its own entry. */
export function activityEntry(type, { assignmentId = "", courseId = "", title, courseTitle = "" }, now = Date.now()) {
  const once = type === "added" ? "added_" + assignmentId : type === "course_added" ? "course_added_" + courseId : "";
  const id = once || type + "_" + (assignmentId || courseId) + "_" + now;
  const data = { type, title: String(title).slice(0, 120), courseTitle: String(courseTitle).slice(0, 80) };
  if (type.startsWith("course_")) data.courseId = courseId;
  else data.assignmentId = assignmentId;
  return { id, data };
}

const ACTIVITY_WORDS = {
  added: " added", submitted: " marked as submitted", started: " started", edited: " edited",
  course_added: " course added", course_edited: " course updated"
};

function activityItems(docs) {
  return docs
    .filter((d) => ACTIVITY_TYPES.includes(d.type) && toDate(d.createdAt))
    .map((d) => ({
      key: d.id, type: d.type, assignmentId: d.assignmentId || "", courseId: d.courseId || "",
      title: d.title + ACTIVITY_WORDS[d.type],
      courseName: d.type.startsWith("course_") ? "" : (d.courseTitle || ""), time: toDate(d.createdAt).getTime()
    }));
}

/* ---------- Read state ---------- */
export const EMPTY_READ = { allBefore: 0, keys: {} };

export function isUnread(item, read) {
  const r = read || EMPTY_READ;
  if (r.keys && r.keys[item.key]) return false;
  return item.time > (r.allBefore || 0);
}

/* Marks one item read. Old entries are dropped so the record stays small. */
export function markRead(read, item, now = Date.now()) {
  const r = read || EMPTY_READ;
  const keys = { ...(r.keys || {}), [item.key]: item.time };
  const cutoff = Math.max(r.allBefore || 0, now - WINDOW_DAYS * DAY);
  Object.keys(keys).forEach((k) => { if (keys[k] <= cutoff) delete keys[k]; });
  return { allBefore: r.allBefore || 0, keys };
}

export function markAllRead(now = Date.now()) {
  return { allBefore: now, keys: {} };
}

/* ---------- The list ---------- */
/* Everything the page shows, newest first. courseNames maps a course id to its title. */
export function buildNotificationItems({ settings, assignments, activity, courseNames = new Map(), now = new Date() }) {
  const nowMs = now instanceof Date ? now.getTime() : now;
  const s = settings || alertSettingsFrom({});
  const alerts = s.alertsEnabled ? deriveAlerts({ assignments: assignments || [], now: nowMs, alertHours: s.alertHours }) : [];
  const withCourse = alerts.map((a) => ({ ...a, courseName: courseNames.get(a.courseId) || "" }));
  const all = [...withCourse, ...activityItems(activity || [])]
    .filter((i) => i.time > nowMs - WINDOW_DAYS * DAY && i.time <= nowMs + 60000);
  all.sort((a, b) => b.time - a.time || a.key.localeCompare(b.key));
  const read = s.read || EMPTY_READ;
  return all.map((i) => ({ ...i, unread: isUnread(i, read) }));
}

export const hasUnread = (items) => items.some((i) => i.unread);

const FILTER_TYPES = {
  reminders: ["reminder"], overdue: ["overdue"], added: ["added"], submitted: ["submitted"],
  updates: ["started", "edited"], courses: ["course_added", "course_edited"]
};

export function filterItems(items, filter) {
  if (filter === "unread") return items.filter((i) => i.unread);
  const types = FILTER_TYPES[filter];
  return types ? items.filter((i) => types.includes(i.type)) : items;
}

export function pageSlice(items, visible = PAGE_SIZE) {
  return { shown: items.slice(0, visible), hasMore: items.length > visible, remaining: Math.max(0, items.length - visible) };
}

export function emptyMessage(filter) {
  const messages = {
    all: ["You are all caught up", "New alerts will show up here."],
    unread: ["No unread notifications", "You have read everything."],
    reminders: ["No due soon alerts", "They appear here shortly before an assignment is due."],
    overdue: ["Nothing is overdue", "Nice work staying on top of things."],
    added: ["Nothing added recently", "Assignments you add will show up here."],
    submitted: ["Nothing submitted recently", "Assignments you mark as submitted will show up here."],
    updates: ["No recent updates", "Assignments you start or edit will show up here."],
    courses: ["No recent course changes", "Courses you add or edit will show up here."]
  };
  const [title, text] = messages[filter] || messages.all;
  return { title, text };
}

/* "5m ago", "2h ago", "Yesterday", "Oct 12" (with the year when it is not this year) */
export function timeAgo(ms, now = new Date()) {
  const nowDate = now instanceof Date ? now : new Date(now);
  const diff = nowDate.getTime() - ms;
  if (diff < 60000) return "Just now";
  if (diff < HOUR) return Math.floor(diff / 60000) + "m ago";
  const then = new Date(ms);
  const midnight = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate()).getTime();
  if (ms >= midnight && diff < DAY) return Math.floor(diff / HOUR) + "h ago";
  if (ms >= midnight - DAY && ms < midnight) return "Yesterday";
  if (diff < DAY) return Math.floor(diff / HOUR) + "h ago";
  const opts = { month: "short", day: "numeric" };
  if (then.getFullYear() !== nowDate.getFullYear()) opts.year = "numeric";
  return then.toLocaleDateString("en-US", opts);
}
