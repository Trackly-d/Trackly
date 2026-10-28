/* ==========================================================
   TRACKLY push logic (pure: no Firebase, no browser, no Cloudflare, tested in Node)
   Shared by the website AND the push Worker (worker-push/ imports this file), so both always agree on:
     - the kinds of push and which are on by default
     - WHEN a due soon or overdue push is sent (the same times as the in-app alerts)
     - the words of every push
     - whether this browser can receive push at all
   All times are milliseconds.
   ========================================================== */

export const HOUR = 3600000;
export const GRACE_MS = 30 * 60000;            // a push that is more than 30 minutes late is dropped, never sent stale
export const ALERT_HOURS = [3, 24, 48];
export const DEFAULT_ALERT_HOURS = [48, 24];

/* key, and whether it is on for a new student */
export const PUSH_TYPES = [
  ["due", true], ["overdue", true],
  ["added", true], ["started", false], ["submitted", true], ["edited", false], ["deleted", false],
  ["course_added", false], ["course_edited", false]
];
export const TYPE_KEYS = PUSH_TYPES.map(([key]) => key);
export const EVENT_KINDS = TYPE_KEYS.filter((k) => k !== "due" && k !== "overdue");
export const COURSE_KINDS = ["course_added", "course_edited"];

/* Always returns every key as true or false. Anything missing or odd falls back to the default. */
export function normalizeTypes(input) {
  const given = input && typeof input === "object" ? input : {};
  const out = {};
  for (const [key, def] of PUSH_TYPES) out[key] = typeof given[key] === "boolean" ? given[key] : def;
  return out;
}

export function normalizeHours(list) {
  if (!Array.isArray(list)) return DEFAULT_ALERT_HOURS.slice();
  return Array.from(new Set(list.map(Number))).filter((h) => ALERT_HOURS.includes(h)).sort((a, b) => b - a);
}

/* The page's id for a type switch: course_added becomes st-push-course-added */
export const switchId = (key) => "st-push-" + key.replace(/_/g, "-");

/* ---------- When to send ----------
   The earliest push after `after` for one open assignment, or null.
   Same rules as the in-app alerts: only times after the assignment was added, and nothing at all when alerts are off. */
export function nextAlarm({ dueMs, createdMs = 0, hours, enabled = true, after }) {
  if (!enabled || !Number.isFinite(dueMs) || !Number.isFinite(after)) return null;
  let best = null;
  for (const h of normalizeHours(hours)) {
    const at = dueMs - h * HOUR;
    if (at >= createdMs && at > after && (!best || at < best.at)) best = { at, kind: "due", hours: h };
  }
  if (dueMs > after && (!best || dueMs < best.at)) best = { at: dueMs, kind: "overdue", hours: 0 };
  return best;
}

/* ---------- The words ---------- */
function clean(value, max) {
  return String(value == null ? "" : value).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

/* Returns { title, body, url, tag }. `name` is the assignment or course title. */
export function pushText(kind, { id = "", name = "", courseName = "", hours = 0 } = {}) {
  const t = clean(name, 120) || "Your assignment";
  const course = clean(courseName, 80);
  const body = course ? "Course: " + course : "Open Trackly to see the details.";
  const safeId = encodeURIComponent(clean(id, 64));
  const open = safeId ? "/assignment.html?id=" + safeId : "/assignments.html";
  const courseUrl = safeId ? "/course.html?id=" + safeId : "/courses.html";
  switch (kind) {
    case "due": return { title: t + " is due in " + hours + " hours", body, url: open, tag: "due:" + safeId + ":" + hours };
    case "overdue": return { title: t + " is overdue", body, url: open, tag: "overdue:" + safeId };
    case "added": return { title: t + " added", body, url: open, tag: "added:" + safeId };
    case "started": return { title: t + " started", body, url: open, tag: "started:" + safeId };
    case "submitted": return { title: t + " marked as submitted", body, url: open, tag: "submitted:" + safeId };
    case "edited": return { title: t + " was edited", body, url: open, tag: "edited:" + safeId };
    case "deleted": return { title: t + " was deleted", body, url: "/assignments.html", tag: "deleted:" + safeId };
    case "course_added": return { title: t + " course added", body: "Open Trackly to see your courses.", url: courseUrl, tag: "course_added:" + safeId };
    case "course_edited": return { title: t + " course updated", body: "Open Trackly to see your courses.", url: courseUrl, tag: "course_edited:" + safeId };
    default: return null;
  }
}

/* ---------- What the website sends the Worker for one assignment ----------
   `a` is an assignment record; toMs turns a Firestore time into milliseconds. Returns null when it should not be watched. */
export function watchItem(a, courseName, toMs) {
  if (!a || !a.id) return null;
  const due = toMs(a.dueAt);
  if (!due) return null;
  const open = a.status === "pending" || a.status === "in_progress";
  return {
    assignmentId: a.id, title: clean(a.title, 120), courseName: clean(courseName, 80),
    dueAt: new Date(due).toISOString(), createdAt: new Date(toMs(a.createdAt) || Date.now()).toISOString(),
    status: open ? "open" : "closed"
  };
}

/* ---------- Can this browser receive push? ----------
   Returns "ok" | "unsupported" | "ios" (iPhone or iPad: add to the Home Screen first) | "blocked" (the student said no). */
export function pushSupport({ isIos = false, standalone = false, hasServiceWorker = false, hasPushManager = false, hasNotification = false, permission = "default" }) {
  if (isIos && !standalone) return "ios";
  if (!hasServiceWorker || !hasPushManager || !hasNotification) return "unsupported";
  if (permission === "denied") return "blocked";
  return "ok";
}

/* The public VAPID key arrives as base64url text; the browser wants bytes */
export function urlBase64ToBytes(text) {
  const clean64 = String(text).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(clean64 + "=".repeat((4 - (clean64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
