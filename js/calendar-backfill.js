/* ==========================================================
   TRACKLY "add reminders to existing assignments" (logic only, tested without a browser)
   For assignments made before Google Calendar was connected (or whose reminders could not be added).

   Which assignments: open (Pending or In Progress), due in the future, reminders not switched to None,
   and no reminders in the calendar yet. Earliest due first. One press handles up to 50.
   It stops at the first Calendar problem, and what was already added stays added.
   ========================================================== */

import { buildCalendarRequest, eventIdsOf, createReminders } from "./calendar-sync.js";
import { toDate } from "./assignments.js";

export const BACKFILL_MAX = 50;

/* Returns { jobs, skipped, remaining }
   jobs:      [{ item, request }] the ones to do now (at most max)
   skipped:   open assignments with no reminder time left ahead (nothing to add)
   remaining: how many more are waiting for another press */
export function planBackfill({ items, now = new Date(), timeZone, courseName = () => "", max = BACKFILL_MAX }) {
  const wanted = items
    .filter((item) => {
      const due = toDate(item.dueAt);
      return (item.status === "pending" || item.status === "in_progress")
        && due && due.getTime() > now.getTime()
        && !(item.reminder && item.reminder.mode === "none")
        && eventIdsOf(item.calendar).length === 0;
    })
    .sort((a, b) => toDate(a.dueAt) - toDate(b.dueAt));

  const jobs = [];
  let skipped = 0;
  for (const item of wanted) {
    const request = buildCalendarRequest({
      assignmentId: item.id, title: item.title, courseName: courseName(item.courseId),
      dueAt: toDate(item.dueAt), reminder: item.reminder || { mode: "default" }, now, timeZone
    });
    if (request) jobs.push({ item, request });
    else skipped++;
  }
  return { jobs: jobs.slice(0, max), skipped, remaining: Math.max(0, jobs.length - max) };
}

/* Does the jobs one by one. saveEvents(job, events) records the new events on that assignment.
   Returns { added, stopped, total } where stopped is null, "notconnected", "reconnect" or "failed". */
export async function runBackfill({ client, jobs, saveEvents, onProgress }) {
  let added = 0;
  let stopped = null;
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    const outcome = await createReminders({ client, request: job.request, saveEvents: (events) => saveEvents(job, events) });
    if (outcome.result === "ok") added++;
    else if (outcome.result !== "none") { stopped = outcome.result; break; }
    if (onProgress) onProgress(i + 1, jobs.length);
  }
  return { added, stopped, total: jobs.length };
}

const count = (n) => n + (n === 1 ? " assignment" : " assignments");

/* The sentence shown in the row when it is finished. kind is "done" or "problem". */
export function backfillMessage({ added, skipped = 0, remaining = 0, stopped = null }) {
  if (stopped) {
    const lead = added ? "Stopped after " + count(added) : "Nothing was added";
    if (stopped === "reconnect") return { kind: "problem", text: lead + ". Reconnect Google Calendar, then press the button again." };
    if (stopped === "notconnected") return { kind: "problem", text: lead + ". Google Calendar is not connected. Connect it first, then press the button again." };
    return { kind: "problem", text: lead + ", because Google Calendar could not be reached. Try again in a moment." };
  }
  const parts = [];
  if (added) parts.push("Added reminders to " + count(added) + ".");
  else parts.push(skipped ? "Nothing to add." : "All your open assignments already have reminders.");
  if (skipped) parts.push(skipped + (skipped === 1 ? " was skipped because it has" : " were skipped because they have") + " no reminder time ahead.");
  if (remaining) parts.push(remaining + (remaining === 1 ? " more is" : " more are") + " waiting. Press the button again.");
  return { kind: "done", text: parts.join(" ") };
}