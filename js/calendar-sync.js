/* ==========================================================
   TRACKLY reminder syncing (logic only, no Firebase, tested without a browser)
   Decides WHAT to ask Google Calendar for, and what to do when a step fails.
   The pages hand in the real client and the real saving functions ("injected"), which is how the tests
   can use pretend ones.

   Rules (decided with the developer):
     - the assignment is always saved FIRST, so a Calendar problem never loses it
     - a Calendar problem never undoes or blocks what the student did
     - if events were made but could not be recorded on the assignment, they are taken back
     - if events cannot be removed right now, their ids are queued and removed on a later visit
   ========================================================== */

import { planReminders } from "./reminders.js";
import { toDate } from "./assignments.js";

/* The request body for POST /calendar/events, or null when there is nothing to remind about
   (reminders off, or every reminder time has already passed). It is exactly what the Worker accepts. */
export function buildCalendarRequest({ assignmentId, title, courseName = "", dueAt, reminder, now = new Date(), timeZone }) {
  const mode = reminder && reminder.mode ? reminder.mode : "default";
  const plan = planReminders({ dueAt, now, mode, minutes: (reminder && reminder.minutes) || [] });
  const dueMinutes = plan.due ? plan.due.minutes : [];
  const daily = plan.daily ? { first: plan.daily.first.toISOString(), count: plan.daily.count } : null;
  if (!dueMinutes.length && !daily) return null;
  return { assignmentId, title, courseName, timeZone, due: dueAt.toISOString(), dueMinutes, daily };
}

/* The ids of the Google events saved on an assignment, or [] */
export function eventIdsOf(calendar) {
  return calendar && Array.isArray(calendar.events) ? calendar.events.map((e) => e.id).filter(Boolean) : [];
}

/* What is saved on the assignment after events are made */
export function calendarField(events, timeZone) {
  return { events: events.map((e) => ({ kind: e.kind, id: e.id })), timeZone };
}

const normalReminder = (r) => {
  const mode = r && r.mode ? r.mode : "default";
  return { mode, minutes: mode === "custom" ? (r.minutes || []).map(Number).sort((a, b) => b - a) : [] };
};
const timeOf = (v) => { const d = toDate(v); return d ? d.getTime() : null; };

/* After an edit: do the events in the calendar need to be rebuilt?
   Only things that appear in them count (title, course, due moment, reminder choice). Notes do not. */
export function needsRebuild(before, after) {
  return before.title !== after.title
    || before.courseId !== after.courseId
    || timeOf(before.dueAt) !== timeOf(after.dueAt)
    || JSON.stringify(normalReminder(before.reminder)) !== JSON.stringify(normalReminder(after.reminder));
}

const RESULT_FOR_CODE = { reconnect: "reconnect", not_connected: "notconnected" };

/* Makes the events, then records them. Result: "ok" | "none" | "notconnected" | "reconnect" | "failed" */
export async function createReminders({ client, request, saveEvents }) {
  if (!request) return { result: "none" };
  let events;
  try {
    events = await client.createEvents(request);
  } catch (err) {
    return { result: RESULT_FOR_CODE[err && err.code] || "failed" };
  }
  if (!events.length) return { result: "none" };
  try {
    await saveEvents(events);
  } catch (err) {
    try { await client.deleteEvents(events.map((e) => e.id)); } catch (again) { /* nothing more to do */ }
    return { result: "failed" };
  }
  return { result: "ok", events };
}

/* Removes events. Result: "ok" | "none" | "queued" (try again on a later visit) | "failed" */
export async function removeReminders({ client, eventIds, queueCleanup }) {
  if (!eventIds.length) return { result: "none" };
  try {
    await client.deleteEvents(eventIds);
    return { result: "ok" };
  } catch (err) {
    try { await queueCleanup(eventIds); return { result: "queued" }; } catch (again) { return { result: "failed" }; }
  }
}

/* Works through queued removals. Stops at once if Calendar cannot be reached or needs a reconnect.
   Returns how many were finished. */
export async function runCleanup({ client, items, finish }) {
  let done = 0;
  for (const item of items) {
    try {
      await client.deleteEvents(item.eventIds);
      await finish(item.id);
      done++;
    } catch (err) {
      if (err && ["reconnect", "not_connected", "network", "timeout", "sign_in_needed"].includes(err.code)) break;
    }
  }
  return done;
}

/* A sentence for the page the student lands on, or "" when everything is fine */
export function reminderNotice(result) {
  if (result === "notconnected") return "Connect Google Calendar in Profile to get reminders.";
  if (result === "reconnect") return "Reconnect Google Calendar in Profile to get reminders.";
  if (result === "failed") return "Reminders could not be added. Edit the assignment to try again.";
  return "";
}