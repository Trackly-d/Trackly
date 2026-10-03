/* ==========================================================
   TRACKLY assignment rules
   The one place that decides what an assignment's status is,
   what counts as "due this week", and which rows the dashboard shows.
   The dashboard and My Courses both use this, so they always agree.

   An assignment is saved with a status of "pending", "in_progress" or "submitted".
   "overdue" is never saved. It is worked out here from the due date.
   ========================================================== */

export const STATUS_LABELS = {
  pending: "Pending",
  in_progress: "In Progress",
  overdue: "Overdue",
  submitted: "Submitted"
};

/* How many rows the dashboard lists show */
const TOTAL_ROWS = 6;
const UPCOMING_ROWS = 3;
const SEARCH_ROWS = 8;

/* ---------- Dates ---------- */

/* Firestore gives us Timestamps, the demo gives plain dates. This handles both. */
export function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  const date = value instanceof Date ? value : new Date(value);
  return isNaN(date.getTime()) ? null : date;
}

export function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/* The current calendar week, from Monday 00:00 up to the next Monday 00:00 */
export function weekRange(now = new Date(), weekStartsOn = 1) {
  const start = startOfDay(now);
  start.setDate(start.getDate() - ((start.getDay() - weekStartsOn + 7) % 7));
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return { start, end };
}

/* "Today", "Tomorrow", "Friday", or "12 Oct" for dates further away */
export function dayLabel(date, now) {
  const days = Math.round((startOfDay(date) - startOfDay(now)) / 86400000);
  if (days < 0) return "Overdue";
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days < 7) return date.toLocaleDateString("en-GB", { weekday: "long" });
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/* "Friday, 11:59 PM" */
export function deadlineText(date, now) {
  const time = date.toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: true })
    .replace(/am|pm/i, (m) => m.toUpperCase());
  return dayLabel(date, now) + ", " + time;
}

/* "Fri, Oct 24 · 11:59 PM" */
export function formatDue(date) {
  if (!date) return "No due date";
  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) +
    " \u00B7 " + date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/* ---------- Status ---------- */

/* Submitted stays submitted. Anything else past its due date is Overdue. */
export function effectiveStatus(assignment, now = new Date()) {
  if (assignment.status === "submitted" || assignment.done === true) return "submitted";
  const due = toDate(assignment.dueAt);
  if (due && due < now) return "overdue";
  return assignment.status === "in_progress" ? "in_progress" : "pending";
}

/* Due in the current week, and still to do (not submitted, not overdue) */
export function isDueThisWeek(assignment, now = new Date()) {
  const status = effectiveStatus(assignment, now);
  if (status === "submitted" || status === "overdue") return false;
  const due = toDate(assignment.dueAt);
  if (!due) return false;
  const { start, end } = weekRange(now);
  return due >= start && due < end;
}

/* ---------- What the dashboard shows ---------- */

function byDue(x, y) {
  const a = x.due ? x.due.getTime() : Infinity;
  const b = y.due ? y.due.getTime() : Infinity;
  return a - b;
}

export function buildModel(courses, assignments, now = new Date()) {
  const courseById = new Map(courses.map((c) => [c.id, c]));

  const items = assignments.map((a) => ({
    id: a.id,
    title: a.title || "Untitled assignment",
    due: toDate(a.dueAt),
    status: effectiveStatus(a, now),
    course: courseById.get(a.courseId) || null
  }));

  // Every assignment is counted once
  const counts = { pending: 0, in_progress: 0, submitted: 0, overdue: 0 };
  items.forEach((item) => { counts[item.status] += 1; });

  const weekCount = assignments.filter((a) => isDueThisWeek(a, now)).length;

  const overdue = items.filter((i) => i.status === "overdue").sort(byDue);
  const open = items.filter((i) => i.status === "pending" || i.status === "in_progress").sort(byDue);

  return {
    items,
    counts,
    weekCount,
    // Overdue first, then the soonest due. Submitted work is left off this list.
    total: [...overdue, ...open].slice(0, TOTAL_ROWS),
    openCount: overdue.length + open.length,
    // Only work still to do, with a date still ahead
    upcoming: open.filter((i) => i.due).slice(0, UPCOMING_ROWS)
  };
}

/* The dashboard search: looks at every assignment, submitted ones too */
export function searchItems(items, query) {
  const term = query.trim().toLowerCase();
  if (!term) return [];
  return items
    .filter((item) => {
      const text = [
        item.title,
        item.course ? item.course.code : "",
        item.course ? item.course.title : "",
        formatDue(item.due),
        STATUS_LABELS[item.status]
      ].join(" ").toLowerCase();
      return text.includes(term);
    })
    .sort(byDue)
    .slice(0, SEARCH_ROWS);
}