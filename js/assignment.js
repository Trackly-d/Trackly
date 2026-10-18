/* ==========================================================
   TRACKLY single assignment page
   Shows one assignment, lets the student set Pending, In Progress or Submitted, edit it, or delete it.

   Reads: one assignment document and its course (both remembered for a minute). No lists.
   Writes: a status tap updates only status, startedAt, submittedAt and updatedAt. Delete removes one document.
   After any change: invalidateCache(uid), so the lists and numbers are right on the next page.

   Overdue is never saved. It is worked out from the due time (effectiveStatus), shown as a red button
   that cannot be tapped. Overdue and Submitted assignments cannot be edited.

   Design views (no data is read):
     assignment.html?state=loading | ?state=error | ?state=notfound
   ========================================================== */

import { startApp, showToast } from "./shell.js";
import { db, doc, updateDoc, deleteDoc, deleteField, serverTimestamp } from "./firebase-config.js";
import { fetchAssignment } from "./assignments-data.js";
import { fetchCourse } from "./courses-data.js";
import { invalidateCache } from "./cache.js";
import { confirmDialog } from "./dialog.js";
import { el, safeColor, showMessage, hideMessage } from "./ui.js";
import { effectiveStatus, toDate, STATUS_LABELS } from "./assignments.js";
import { parseMarkdown } from "./markdown.js";
import { fetchUserRecord } from "./users.js";
import { createCalendarClient } from "./calendar-client.js";
import { buildCalendarRequest, eventIdsOf, calendarField, createReminders, removeReminders, reminderNotice } from "./calendar-sync.js";
import { saveCalendarField, clearCalendarField, queueCleanup } from "./calendar-store.js";
import { writeActivity, removeActivityFor } from "./notifications-data.js";
import { activityEntry } from "./notifications-logic.js";
import { statusChange, editRule, dueDateText, dueTimeText, createdText, modifiedText, unitTopicText, PRIORITY_LABELS } from "./assignment-status.js";

const SAVE_LIMIT_MS = 20000;
const PARAMS = new URLSearchParams(window.location.search);
const STATE = PARAMS.get("state");
const ID_OK = /^[A-Za-z0-9_-]{1,64}$/;
const PILLS = {
  pending: "pill pill-pending",
  in_progress: "pill pill-progress",
  overdue: "pill pill-overdue",
  submitted: "pill pill-submitted"
};

const $ = (id) => document.getElementById(id);
const views = { loading: $("sa-loading"), error: $("sa-error"), notfound: $("sa-notfound"), page: $("sa-page") };
const statusGroup = $("status-group");
const statusButtons = Array.from(statusGroup.querySelectorAll("button[data-status]"));
const statusMsg = $("sa-status-msg");
const editBtn = $("edit-btn");
const deleteBtn = $("delete-btn");

let uid = "";
let authUser = null;
let id = "";
let ref = null;
let a = null;        // the assignment (plain object)
let course = null;   // its course, or null
let saving = false;

function show(name) {
  Object.keys(views).forEach((key) => { views[key].hidden = key !== name; });
}

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error("save-timeout")), ms))]);
}

/* ---------- Google Calendar reminders ----------
   These run only AFTER the change is saved. A Calendar problem never undoes or blocks what the student did. */
const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
const client = createCalendarClient({ getToken: () => authUser.getIdToken() });

/* Removes this assignment's reminders (Submitted, or Delete). If Calendar cannot be reached right now,
   the ids are queued and removed on a later visit. docExists is false after a delete. */
async function removeCalendar(docExists) {
  const ids = eventIdsOf(a.calendar);
  if (!ids.length) return;
  showMessage(statusMsg, "Removing your calendar reminders...");
  const outcome = await removeReminders({ client, eventIds: ids, queueCleanup: (list) => queueCleanup(uid, id, list) });
  hideMessage(statusMsg);
  if (outcome.result === "failed") return; // could not even queue it: keep the ids on the assignment
  if (docExists) {
    try { await clearCalendarField(ref); a.calendar = null; } catch (err) { console.error("Could not clear the reminders note:", err); }
  }
  if (outcome.result === "queued") {
    showMessage(statusMsg, "Saved. Your calendar reminders could not be removed just now. Trackly will remove them next time Google Calendar can be reached.");
  }
}

/* Moved from Submitted back to open: bring the reminders back if Calendar is connected and they are still wanted */
async function restoreCalendar() {
  if (eventIdsOf(a.calendar).length) return;
  const request = buildCalendarRequest({
    assignmentId: id, title: a.title, courseName: course ? course.title : "", dueAt: toDate(a.dueAt),
    reminder: a.reminder || { mode: "default" }, now: new Date(), timeZone: TIME_ZONE
  });
  if (!request) return;
  let settings = null;
  try { settings = await fetchUserRecord(uid); } catch (err) { return; }
  if (!(settings && settings.calendar && settings.calendar.connected)) return;

  showMessage(statusMsg, "Adding your reminders back...");
  const outcome = await createReminders({
    client, request,
    saveEvents: async (events) => { await saveCalendarField(ref, events, TIME_ZONE); a.calendar = calendarField(events, TIME_ZONE); }
  });
  hideMessage(statusMsg);
  const notice = reminderNotice(outcome.result);
  if (notice) showMessage(statusMsg, "Saved. " + notice);
}

/* The history on the Notifications page. Never in the student's way. */
async function noteSubmitted() {
  try {
    await writeActivity(uid, activityEntry("submitted", { assignmentId: id, title: a.title, courseTitle: course ? course.title : "" }));
    invalidateCache(uid);
  } catch (err) {
    console.error("Could not save the notification:", err);
  }
}

async function afterStatusSaved(change) {
  if (change.status === "submitted") await noteSubmitted();
  try {
    if (change.status === "submitted") await removeCalendar(true);
    else if (change.submittedAt === "clear") await restoreCalendar();
  } catch (err) {
    console.error("Calendar reminders problem:", err);
    hideMessage(statusMsg);
  }
}

async function onDeleted() {
  try { await removeActivityFor(uid, id); } catch (err) { console.error("Could not tidy the notifications:", err); }
  try { await removeCalendar(false); } catch (err) { console.error("Calendar reminders problem:", err); }
}

/* ---------- Notes: the safe markdown tree becomes real elements, with textContent only ---------- */
function inlineNodes(nodes) {
  return nodes.map((n) => {
    if (n.t === "br") return document.createElement("br");
    if (n.t === "strong") return el("strong", "", n.v);
    if (n.t === "em") return el("em", "", n.v);
    return document.createTextNode(n.v);
  });
}

function renderNotes(box, text) {
  box.replaceChildren();
  const blocks = parseMarkdown(text);
  if (!blocks.length) { box.append(el("p", "", "No notes.")); return; }
  blocks.forEach((block) => {
    if (block.t === "p") {
      const p = el("p");
      p.append(...inlineNodes(block.c));
      box.append(p);
    } else {
      const list = el(block.t);
      block.c.forEach((item) => {
        const li = el("li");
        li.append(...inlineNodes(item.c));
        list.append(li);
      });
      box.append(list);
    }
  });
}

/* ---------- Drawing the page from the data ---------- */
function draw() {
  const now = new Date();
  const status = effectiveStatus(a, now);
  const due = toDate(a.dueAt);

  document.title = a.title + " | Trackly";
  $("sa-title").textContent = a.title;

  $("course-chip-text").textContent = course ? course.title : "Course";
  $("course-dot").style.setProperty("--dot", safeColor(course && course.color));

  const unitTopic = unitTopicText(a);
  $("sa-unit-topic").textContent = unitTopic;
  $("sa-unit-topic").hidden = !unitTopic;

  const pill = $("sa-pill");
  pill.className = PILLS[status] || PILLS.pending;
  pill.textContent = STATUS_LABELS[status] || "Pending";
  $("sa-modified").textContent = modifiedText(toDate(a.updatedAt) || toDate(a.createdAt), now);

  $("sa-due-date").textContent = dueDateText(due, now);
  $("sa-due-time").textContent = dueTimeText(due);

  // Assignments saved before Priority existed have none, so that row is hidden
  const priority = $("sa-priority");
  priority.closest(".sa-row").hidden = !a.priority;
  if (a.priority) {
    priority.dataset.level = a.priority;
    $("sa-priority-text").textContent = PRIORITY_LABELS[a.priority] || "Medium";
  }

  renderNotes($("sa-notes"), a.description);

  statusButtons.forEach((button) => {
    button.setAttribute("aria-pressed", String(a.status === button.dataset.status));
    button.disabled = saving;
  });
  statusGroup.classList.toggle("is-overdue", status === "overdue");

  const rule = editRule(a, now);
  if (rule.ok) {
    editBtn.href = "add-assignment.html?edit=" + encodeURIComponent(id);
    editBtn.removeAttribute("aria-disabled");
  } else {
    editBtn.removeAttribute("href");
    editBtn.setAttribute("aria-disabled", "true");
  }
  $("edit-locked").textContent = rule.reason;
  $("edit-locked").hidden = rule.ok;
  deleteBtn.disabled = saving;

  $("sa-created").textContent = createdText(toDate(a.createdAt));
  const instructor = course && course.instructor ? course.instructor : "";
  $("sa-instructor").textContent = instructor;
  $("row-instructor").hidden = !instructor;
  $("sa-format").textContent = a.submissionFormat || "";
  $("row-format").hidden = !a.submissionFormat;
  $("sa-info").textContent = a.submissionInfo || "";
  $("sa-info-card").hidden = !a.submissionInfo;
}

/* ---------- Status taps ---------- */
function setSaving(on) {
  saving = on;
  statusButtons.forEach((button) => { button.disabled = on; });
  deleteBtn.disabled = on;
}

async function onStatusTap(event) {
  const button = event.target.closest("button[data-status]");
  if (!button || saving) return;
  const change = statusChange(a, button.dataset.status);
  if (!change) return;

  // The screen changes at once. If saving fails, the old values come back.
  const before = { status: a.status, startedAt: a.startedAt, submittedAt: a.submittedAt, updatedAt: a.updatedAt };
  const nowMs = Date.now();
  a.status = change.status;
  if (change.startedAt === "now") a.startedAt = nowMs;
  if (change.submittedAt === "now") a.submittedAt = nowMs;
  if (change.submittedAt === "clear") delete a.submittedAt;
  a.updatedAt = nowMs;
  hideMessage(statusMsg);
  setSaving(true);
  draw();

  let saved = false;
  const fields = { status: change.status, updatedAt: serverTimestamp() };
  if (change.startedAt === "now") fields.startedAt = serverTimestamp();
  if (change.submittedAt === "now") fields.submittedAt = serverTimestamp();
  if (change.submittedAt === "clear") fields.submittedAt = deleteField();

  try {
    await withTimeout(updateDoc(ref, fields), SAVE_LIMIT_MS);
    invalidateCache(uid);
    saved = true;
  } catch (err) {
    console.error("Could not save the status:", err);
    Object.assign(a, before);
    if (before.startedAt === undefined) delete a.startedAt;
    if (before.submittedAt === undefined) delete a.submittedAt;
    showMessage(statusMsg, "Could not save. Check your connection and try again.");
  }
  if (saved) await afterStatusSaved(change); // Calendar comes after the save and never undoes it
  setSaving(false);
  draw();
}

/* ---------- Delete ---------- */
async function onDelete() {
  if (saving) return;
  const yes = await confirmDialog({
    title: "Delete this assignment?",
    message: "\"" + a.title + "\" will be removed for good. This cannot be undone.",
    confirmText: "Delete",
    cancelText: "Keep it",
    danger: true
  });
  if (!yes) return;

  hideMessage(statusMsg);
  setSaving(true);
  try {
    await withTimeout(deleteDoc(ref), SAVE_LIMIT_MS);
    invalidateCache(uid);
    await onDeleted();
    window.location.replace("assignments.html?deleted=1");
  } catch (err) {
    console.error("Could not delete the assignment:", err);
    showMessage(statusMsg, "Could not delete. Check your connection and try again.");
    setSaving(false);
    draw();
  }
}

/* ---------- Loading ---------- */
async function load() {
  show("loading");
  try {
    a = await fetchAssignment(uid, id);
    if (!a) { show("notfound"); return; }
    course = a.courseId ? await fetchCourse(uid, a.courseId) : null;
  } catch (err) {
    console.error("Could not load the assignment:", err);
    show("error");
    return;
  }
  draw();
  show("page");

  // Coming back from the edit form
  if (PARAMS.get("saved") === "1") {
    const notice = reminderNotice(PARAMS.get("reminders"));
    showToast("Changes saved" + (notice ? ". " + notice : ""));
    const url = new URL(window.location.href);
    url.searchParams.delete("saved");
    url.searchParams.delete("reminders");
    window.history.replaceState(null, "", url);
  }
}

/* ---------- Start ---------- */
function init(user) {
  uid = user.uid;
  authUser = user;

  // Design review views, no data is read
  if (views[STATE] && STATE !== "page") { show(STATE); return; }

  id = PARAMS.get("id") || "";
  if (!ID_OK.test(id)) { show("notfound"); return; }
  ref = doc(db, "users", uid, "assignments", id);

  statusGroup.addEventListener("click", onStatusTap);
  deleteBtn.addEventListener("click", onDelete);
  $("sa-retry").addEventListener("click", load);
  load();
}

startApp("assignments", init);