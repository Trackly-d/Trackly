/* ==========================================================
   TRACKLY Add Assignment page
   Saves one assignment at users/{uid}/assignments/{id}, then goes back to where the student came from.

   Reads: only the student's courses (remembered for 2 minutes). It never reads assignments.
   Saves: one write. The id is made once, so pressing Create twice never makes two assignments.
   After saving: invalidateCache(uid), then location.replace (so Back does not return to a filled form).

   Reminders: the choice (default, custom or none) is saved on the assignment as "reminder".
   Google Calendar reminders are made AFTER the assignment is saved, so a Calendar problem can never lose it.
   The student lands on the next page with a short note if reminders could not be added.

   Look at the other views of the design:
     add-assignment.html?state=loading | ?state=error | ?state=nocourses
   Open it from a course with ?course=ID to preselect that course.
   Edit mode: add-assignment.html?edit=ID opens the same form filled in. Overdue and Submitted assignments
   cannot be edited (the student is sent to the assignment page, which explains why).
   ========================================================== */

import { startApp, setLeaveGuard, refreshLeaveGuard } from "./shell.js";
import { db, collection, doc, setDoc, updateDoc, deleteField, serverTimestamp } from "./firebase-config.js";
import { fetchCourses } from "./courses-data.js";
import { fetchAssignment } from "./assignments-data.js";
import { fetchUserRecord } from "./users.js";
import { toDate } from "./assignments.js";
import { editRule, dueToInputs } from "./assignment-status.js";
import { createCalendarClient } from "./calendar-client.js";
import { buildCalendarRequest, eventIdsOf, needsRebuild, createReminders, removeReminders } from "./calendar-sync.js";
import { saveCalendarField, clearCalendarField, queueCleanup } from "./calendar-store.js";
import { writeActivity } from "./notifications-data.js";
import { activityEntry } from "./notifications-logic.js";
import { notifyPush, watchPush } from "./push-sync.js";
import { invalidateCache } from "./cache.js";
import { el, showMessage, hideMessage, safeColor } from "./ui.js";
import { validateAssignment, buildAssignmentData, buildAssignmentUpdate, todayString, isFormDirty, LIMITS } from "./assignment-form.js";

const SAVE_LIMIT_MS = 20000;
const PARAMS = new URLSearchParams(window.location.search);
const STATE = PARAMS.get("state");

const $ = (id) => document.getElementById(id);
const views = { loading: $("aa-loading"), error: $("aa-error"), nocourses: $("aa-no-courses"), notfound: $("aa-notfound"), page: $("aa-page") };
const form = $("assignment-form");
const fields = { title: $("a-title"), course: $("a-course"), date: $("a-date"), time: $("a-time"), notes: $("a-notes"), reminder: $("reminder-group") };
const errorBoxes = { title: $("err-title"), course: $("err-course"), date: $("err-date"), time: $("err-time"), notes: $("err-notes"), reminder: $("err-reminder") };
const formError = $("form-error");
const saveStatus = $("save-status");
const saveBtn = $("save-btn");
const saveLabel = $("save-label");
const hint = $("reminder-hint");
const calendarNote = $("calendar-note");
const DEFAULT_HINT = hint.textContent.trim();
const HINTS = {
  default: DEFAULT_HINT,
  custom: "Reminders ring at the times you choose, before the due time. The default schedule is not used.",
  none: "No reminders will be added for this assignment."
};

let uid = "";
let courses = [];
let ref = null;          // created once, so a second click never makes a second assignment
let initial = null;      // what the form held when it opened, for the leave warning
let saving = false;
let allowLeave = false;
let backHref = "assignments.html";
let courseParam = "";
let editId = "";          // set in edit mode
let editing = null;       // the saved assignment being edited
let originalDue = null;   // its saved due moment
let idleLabel = "Create Assignment";
let userSettings = null;  // users/{uid}: the reminders switch and the Google Calendar hint
let authUser = null;
const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
const client = createCalendarClient({ getToken: () => authUser.getIdToken() });

function show(name) {
  Object.keys(views).forEach((key) => { views[key].hidden = key !== name; });
}

/* ---------- Google Calendar ----------
   users/{uid}.calendar.connected is only a display hint kept by the Profile page. It decides whether we even try
   and whether the "not connected" note shows. The Worker always has the final word. */
function isCalendarConnected() {
  return Boolean(userSettings && userSettings.calendar && userSettings.calendar.connected);
}

/* ---------- Reading the form ---------- */
function values() {
  const text = (name) => form.elements[name].value;
  return {
    title: fields.title.value,
    courseId: fields.course.value,
    date: fields.date.value,
    time: fields.time.value,
    notes: fields.notes.value,
    priority: (form.querySelector('input[name="priority"]:checked') || {}).value,
    unit: text("unit"),
    topic: text("topic"),
    submissionFormat: text("submissionFormat"),
    submissionInfo: text("submissionInfo"),
    reminderMode: (form.querySelector('input[name="reminder"]:checked') || {}).value,
    remindMinutes: Array.from(form.querySelectorAll('input[name="remind"]:checked')).map((box) => box.value)
  };
}

/* ---------- Messages ---------- */
function clearErrors() {
  hideMessage(formError);
  Object.keys(errorBoxes).forEach((key) => {
    hideMessage(errorBoxes[key]);
    const input = fields[key];
    if (input && key !== "reminder") { input.classList.remove("is-invalid"); input.removeAttribute("aria-invalid"); }
  });
}

function showErrors(errors) {
  let first = null;
  ["title", "course", "date", "time", "reminder", "notes"].forEach((key) => {
    if (!errors[key]) return;
    showMessage(errorBoxes[key], errors[key]);
    const input = fields[key];
    if (key !== "reminder") { input.classList.add("is-invalid"); input.setAttribute("aria-invalid", "true"); }
    if (!first) first = key === "reminder" ? form.querySelector('input[name="reminder"]:checked') : input;
  });
  if (first) first.focus();
}

/* ---------- Reminder choices ---------- */
function updateReminderUi() {
  const mode = (form.querySelector('input[name="reminder"]:checked') || {}).value || "default";
  hint.textContent = HINTS[mode];

  // At most 5 custom reminders: once 5 are chosen, the others wait
  const boxes = Array.from(form.querySelectorAll('input[name="remind"]'));
  const chosen = boxes.filter((box) => box.checked).length;
  boxes.forEach((box) => { box.disabled = !box.checked && chosen >= LIMITS.maxReminders; });

  calendarNote.hidden = mode === "none" || isCalendarConnected();
}

/* ---------- Course list ---------- */
function paintDot() {
  const option = fields.course.selectedOptions[0];
  $("course-dot").style.setProperty("--dot", option && option.dataset.color ? option.dataset.color : "#CBD5E1");
}

function fillCourses() {
  const select = fields.course;
  select.replaceChildren();
  const placeholder = el("option", "", "Choose a course");
  placeholder.value = "";
  placeholder.disabled = true;
  select.append(placeholder);

  courses.forEach((course) => {
    const label = course.title + (course.code ? " (" + course.code + ")" : "");
    const option = el("option", "", label);
    option.value = course.id;
    option.dataset.color = safeColor(course.color);
    select.append(option);
  });

  // Coming from a course page: that course is already chosen. An unknown id is ignored.
  const wanted = courses.some((course) => course.id === courseParam) ? courseParam : "";
  select.value = wanted;
  if (!wanted) placeholder.selected = true;
  paintDot();
}

/* ---------- Edit mode: fill the form from the saved assignment ---------- */
function prefill(a) {
  const due = dueToInputs(a.dueAt);
  fields.title.value = a.title || "";
  fields.date.value = due.date;
  fields.time.value = due.time;
  fields.notes.value = a.description || "";
  form.elements.unit.value = a.unit || "";
  form.elements.topic.value = a.topic || "";
  form.elements.submissionFormat.value = a.submissionFormat || "";
  form.elements.submissionInfo.value = a.submissionInfo || "";
  const pick = (name, value) => {
    const box = form.querySelector('input[name="' + name + '"][value="' + value + '"]');
    if (box) box.checked = true;
  };
  pick("priority", a.priority || "medium");
  const reminder = a.reminder || { mode: "default" };
  pick("reminder", reminder.mode || "default");
  form.querySelectorAll('input[name="remind"]').forEach((box) => {
    box.checked = Array.isArray(reminder.minutes) && reminder.minutes.map(Number).includes(Number(box.value));
  });
}

/* ---------- Loading ---------- */
async function load() {
  show("loading");
  try {
    courses = (await fetchCourses(uid)).slice().sort((a, b) => String(a.title).localeCompare(String(b.title)));
  } catch (err) {
    console.error("Could not load the courses:", err);
    show("error");
    return;
  }
  if (!courses.length) { show("nocourses"); return; }

  if (editId) {
    try {
      editing = await fetchAssignment(uid, editId);
    } catch (err) {
      console.error("Could not load the assignment:", err);
      show("error");
      return;
    }
    if (!editing) { show("notfound"); return; }
    if (!editRule(editing).ok) {
      allowLeave = true;
      window.location.replace("assignment.html?id=" + encodeURIComponent(editId)); // that page says why it cannot be edited
      return;
    }
    courseParam = editing.courseId || "";
    originalDue = toDate(editing.dueAt);
  }

  fillCourses();
  if (editing) prefill(editing);
  fields.date.min = todayString();

  // One read of the student's settings: the reminders switch and whether Google Calendar is connected
  try { userSettings = await fetchUserRecord(uid); } catch (err) { /* keep the normal defaults */ }
  if (!editing && userSettings && userSettings.remindersEnabled === false) {
    // The student switched "Assignment reminders" off on Profile: a new assignment starts on None
    const none = form.querySelector('input[name="reminder"][value="none"]');
    if (none) none.checked = true;
  }
  updateReminderUi();
  show("page");
  initial = values(); // after the course is preselected, so a preselected course is not a "change"
}

/* ---------- Saving ---------- */
function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error("save-timeout")), ms))]);
}

function setSaving(on) {
  saving = on;
  saveBtn.disabled = on;
  saveLabel.textContent = on ? "Saving..." : idleLabel;
  if (!on) hideMessage(saveStatus);
}

/* Makes, replaces or removes the calendar reminders for what was just saved.
   Returns "ok" | "none" | "notconnected" | "reconnect" | "failed". Never throws. */
async function syncReminders(due) {
  const v = values();
  const reminder = buildAssignmentData(v, due).reminder;
  const course = courses.find((c) => c.id === v.courseId);
  const after = { title: v.title.trim(), courseId: v.courseId, dueAt: due, reminder };
  const request = buildCalendarRequest({
    assignmentId: ref.id, title: after.title, courseName: course ? course.title : "", dueAt: due, reminder, now: new Date(), timeZone: TIME_ZONE
  });
  const connected = isCalendarConnected();
  const oldIds = editing ? eventIdsOf(editing.calendar) : [];

  // Editing: leave the calendar alone unless something shown in the events changed (or reminders were never made)
  if (editing && !needsRebuild(editing, after) && !(request && connected && !oldIds.length)) return "none";

  if (oldIds.length) {
    await removeReminders({ client, eventIds: oldIds, queueCleanup: (ids) => queueCleanup(uid, ref.id, ids) });
    try { await clearCalendarField(ref); } catch (err) { console.error("Could not clear the old reminders:", err); }
  }
  if (!request) return "none";
  if (!connected) return "notconnected";
  const outcome = await createReminders({ client, request, saveEvents: (events) => saveCalendarField(ref, events, TIME_ZONE) });
  return outcome.result;
}

async function onSubmit(event) {
  event.preventDefault();
  if (saving) return;
  clearErrors();

  const now = new Date();
  const result = validateAssignment(values(), now, courses.map((course) => course.id), originalDue);
  if (!result.ok) { showErrors(result.errors); return; }

  setSaving(true);
  showMessage(saveStatus, "Saving your assignment...");
  try {
    // The assignment is saved FIRST, so a Calendar problem later can never lose it
    if (editId) {
      // Only the edited fields change. Status, createdAt, startedAt and submittedAt stay as they are.
      const { set, remove } = buildAssignmentUpdate(values(), result.due);
      const fieldsToSave = { ...set, updatedAt: serverTimestamp() };
      remove.forEach((key) => { fieldsToSave[key] = deleteField(); });
      await withTimeout(updateDoc(ref, fieldsToSave), SAVE_LIMIT_MS);
    } else {
      const data = { ...buildAssignmentData(values(), result.due), createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
      await withTimeout(setDoc(ref, data), SAVE_LIMIT_MS);
    }

    // Reminders come AFTER the save, so a Calendar problem can never lose the assignment
    if (isCalendarConnected() && values().reminderMode !== "none") showMessage(saveStatus, "Adding your reminders...");
    let reminders = "failed";
    try { reminders = await syncReminders(result.due); } catch (err) { console.error("Reminders problem:", err); }
    const problem = ["notconnected", "reconnect", "failed"].includes(reminders) ? "&reminders=" + reminders : "";

    // The history on the Notifications page, and a push to the student's other devices. Neither can ever lose the save.
    const chosen = courses.find((c) => c.id === values().courseId);
    const courseTitle = chosen ? chosen.title : "";
    const savedTitle = values().title.trim();
    const kind = editId ? "edited" : "added";
    try {
      await writeActivity(uid, activityEntry(kind, { assignmentId: ref.id, title: savedTitle, courseTitle }));
    } catch (err) { console.error("Could not save the notification:", err); }
    await notifyPush(authUser, kind, { id: ref.id, title: savedTitle, courseName: courseTitle });
    await watchPush(authUser, [{
      record: { id: ref.id, title: savedTitle, dueAt: result.due, createdAt: editing ? editing.createdAt : new Date(), status: editing ? editing.status : "pending" },
      courseName: courseTitle
    }]);
    invalidateCache(uid); // so the lists and numbers show the new assignment straight away
    allowLeave = true;
    const joiner = backHref.includes("?") ? "&" : "?";
    window.location.replace(backHref + joiner + (editId ? "saved=1" : "added=1") + problem);
  } catch (err) {
    if (err && err.message === "save-timeout") {
      showMessage(formError, "Saving is taking too long. Check your connection and try again.");
    } else {
      console.error("Could not save the assignment:", err);
      showMessage(formError, "We could not save your assignment. Please try again.");
    }
    setSaving(false);
  }
}

/* ---------- Start ---------- */
function init(user) {
  uid = user.uid;
  authUser = user;
  ref = doc(collection(db, "users", uid, "assignments")); // one id for this visit

  const fromCourse = PARAMS.get("course") || "";
  courseParam = /^[A-Za-z0-9_-]{1,64}$/.test(fromCourse) ? fromCourse : "";
  if (courseParam) {
    backHref = "course.html?id=" + encodeURIComponent(courseParam);
    $("back-text").textContent = "Back to Course";
  }
  // Edit mode: ?edit=ID. A made-up id shows the "not found" panel.
  const editParam = PARAMS.get("edit");
  if (editParam) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(editParam)) { show("notfound"); return; }
    editId = editParam;
    ref = doc(db, "users", uid, "assignments", editId);
    backHref = "assignment.html?id=" + encodeURIComponent(editId);
    idleLabel = "Save Changes";
    saveLabel.textContent = idleLabel;
    $("aa-heading").textContent = "Edit Assignment";
    $("aa-subtitle").textContent = "Update your assignment details";
    $("back-text").textContent = "Back to Assignment";
    document.title = "Edit Assignment | Trackly";
  }
  $("back-link").href = backHref;
  $("cancel-link").href = backHref;

  form.addEventListener("submit", onSubmit);
  form.addEventListener("input", () => { refreshLeaveGuard(); });
  form.addEventListener("change", () => { updateReminderUi(); paintDot(); refreshLeaveGuard(); });
  $("aa-retry").addEventListener("click", load);

  setLeaveGuard({
    isDirty: () => !allowLeave && Boolean(initial) && isFormDirty(values(), initial),
    onLeave: () => { allowLeave = true; },
    dialog: {
      title: "Leave without saving?",
      message: editId
        ? "Your changes have not been saved yet. If you leave now, they will be lost."
        : "This assignment has not been saved yet. If you leave now, what you entered will be lost.",
      confirmText: "Leave",
      cancelText: "Keep editing",
      danger: true
    }
  });

  // Closing the tab or refreshing cannot show our box, so the browser's own message is the last net
  window.addEventListener("beforeunload", (event) => {
    if (!allowLeave && initial && isFormDirty(values(), initial)) {
      event.preventDefault();
      event.returnValue = "";
    }
  });

  // Design review views, no data is read
  if (STATE === "loading") { show("loading"); return; }
  if (STATE === "error") { show("error"); return; }
  if (STATE === "nocourses") { show("nocourses"); return; }

  load();
}

startApp("assignments", init);
