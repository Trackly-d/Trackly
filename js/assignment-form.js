/* ==========================================================
   TRACKLY assignment form rules (pure logic, no Firebase, tested without a browser)
   Decides if what the student typed is acceptable, and builds the object that gets saved.

   Rules (decided with the developer):
     title 2 to 120 characters, notes (the description) 2 to 2000, course required,
     due date AND due time both required (no default time), the due moment must be in the future
     (device time), status always starts as "pending".
   Optional fields (unit, topic, submissionFormat, submissionInfo) are saved only when filled.
   ========================================================== */

export const LIMITS = { titleMin: 2, titleMax: 120, notesMin: 2, notesMax: 2000, infoMax: 1000, maxReminders: 5 };
export const PRIORITIES = ["low", "medium", "high"];
export const REMINDER_MODES = ["default", "custom", "none"];
export const CUSTOM_MINUTES = [0, 30, 60, 120, 1440, 2880]; // minutes before the due time

const pad = (n) => String(n).padStart(2, "0");

/* Today as "2026-10-12" in device time (used as the minimum of the date box) */
export function todayString(now = new Date()) {
  return now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate());
}

/* "2026-10-24" and "23:59" become a real date in device time, or null if either is missing or invalid */
export function buildDueDate(date, time) {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || "");
  const t = /^(\d{2}):(\d{2})$/.exec(time || "");
  if (!d || !t) return null;
  const [y, mo, da, h, mi] = [d[1], d[2], d[3], t[1], t[2]].map(Number);
  const due = new Date(y, mo - 1, da, h, mi);
  const same = due.getFullYear() === y && due.getMonth() === mo - 1 && due.getDate() === da &&
    due.getHours() === h && due.getMinutes() === mi;
  return same ? due : null;
}

/* Cleans the typed values: trimmed text, known priority and reminder choices only */
export function normalize(v = {}) {
  const text = (x) => String(x == null ? "" : x).trim();
  const minutes = Array.from(new Set((v.remindMinutes || []).map(Number)))
    .filter((m) => CUSTOM_MINUTES.includes(m))
    .sort((a, b) => b - a);
  return {
    title: text(v.title),
    courseId: text(v.courseId),
    date: text(v.date),
    time: text(v.time),
    notes: text(v.notes),
    priority: PRIORITIES.includes(v.priority) ? v.priority : "medium",
    unit: text(v.unit),
    topic: text(v.topic),
    submissionFormat: text(v.submissionFormat),
    submissionInfo: text(v.submissionInfo),
    reminderMode: REMINDER_MODES.includes(v.reminderMode) ? v.reminderMode : "default",
    remindMinutes: minutes
  };
}

/* Returns { ok, errors, due }. errors has a message for each field that is wrong:
   title, course, date, time, notes, reminder. courseIds (optional) is the list of the student's own courses. */
export function validateAssignment(values, now = new Date(), courseIds = null, originalDue = null) {
  const v = normalize(values);
  const errors = {};

  if (v.title.length < LIMITS.titleMin) errors.title = "Enter the assignment title.";
  else if (v.title.length > LIMITS.titleMax) errors.title = "Keep the title under " + LIMITS.titleMax + " characters.";

  if (!v.courseId || (courseIds && !courseIds.includes(v.courseId))) errors.course = "Choose a course.";

  if (!v.date) errors.date = "Choose the due date.";
  if (!v.time) errors.time = "Choose the due time.";

  let due = null;
  if (v.date && v.time) {
    due = buildDueDate(v.date, v.time);
    if (!due) {
      errors.date = "That date or time is not valid.";
    } else if (originalDue && due.getTime() === originalDue.getTime()) {
      // Editing: a due moment the student did not change is never refused
    } else if (v.date < todayString(now)) {
      errors.date = "The due date cannot be in the past.";
    } else if (due.getTime() <= now.getTime()) {
      errors.time = "That time has already passed today. Choose a later time.";
    }
  }

  if (v.notes.length < LIMITS.notesMin) errors.notes = "Add a few notes about the assignment.";
  else if (v.notes.length > LIMITS.notesMax) errors.notes = "Keep the notes under " + LIMITS.notesMax + " characters.";

  if (v.reminderMode === "custom") {
    if (v.remindMinutes.length === 0) errors.reminder = "Choose at least one reminder, or pick None.";
    else if (v.remindMinutes.length > LIMITS.maxReminders) errors.reminder = "Choose at most " + LIMITS.maxReminders + " reminders.";
  }

  return { ok: Object.keys(errors).length === 0, errors, due: Object.keys(errors).length ? null : due };
}

/* The object saved in Firestore (the page adds createdAt and updatedAt). dueAt is a Date, Firestore stores it as a Timestamp. */
export function buildAssignmentData(values, due) {
  const v = normalize(values);
  const data = {
    courseId: v.courseId,
    title: v.title,
    description: v.notes,
    dueAt: due,
    status: "pending",
    priority: v.priority,
    reminder: v.reminderMode === "custom" ? { mode: "custom", minutes: v.remindMinutes } : { mode: v.reminderMode },
    calendar: null // set when Google Calendar events exist (null lets a later "add reminders" step find these)
  };
  if (v.unit) data.unit = v.unit;
  if (v.topic) data.topic = v.topic;
  if (v.submissionFormat) data.submissionFormat = v.submissionFormat;
  if (v.submissionInfo) data.submissionInfo = v.submissionInfo;
  return data;
}

/* Editing: what to change on the saved assignment. Status, createdAt, startedAt, submittedAt and calendar are not touched.
   Optional fields the student emptied are listed in "remove" (the page deletes them from the document). */
export function buildAssignmentUpdate(values, due) {
  const full = buildAssignmentData(values, due);
  const set = { courseId: full.courseId, title: full.title, description: full.description, dueAt: full.dueAt, priority: full.priority, reminder: full.reminder };
  const remove = [];
  ["unit", "topic", "submissionFormat", "submissionInfo"].forEach((key) => {
    if (full[key]) set[key] = full[key];
    else remove.push(key);
  });
  return { set, remove };
}

/* Has the student changed anything since the page opened? */
export function isFormDirty(current, initial) {
  return JSON.stringify(normalize(current)) !== JSON.stringify(normalize(initial));
}