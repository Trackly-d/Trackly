import { planBackfill, runBackfill, backfillMessage, BACKFILL_MAX } from "../js/calendar-backfill.js";
import { parseEventsRequest } from "../worker-calendar/lib.js";

let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(ok ? "PASS" : "FAIL", name, ok ? "" : "got " + JSON.stringify(got) + " want " + JSON.stringify(want));
};

// Tue 13 Oct 2026, 10:00 (local time)
const now = new Date(2026, 9, 13, 10, 0);
const D = (d, h = 12, m = 0) => new Date(2026, 9, d, h, m);
const item = (id, extra = {}) => ({ id, title: "Task " + id, courseId: "c1", status: "pending", dueAt: D(20).getTime(), reminder: { mode: "default" }, calendar: null, ...extra });
const names = { c1: "Biology" };
const plan = (items, more = {}) => planBackfill({ items, now, timeZone: "Africa/Lagos", courseName: (id) => names[id] || "", ...more });

// ---------- who is included
let p = plan([item("a"), item("b", { status: "in_progress" })]);
check("pending and in progress are included", p.jobs.map((j) => j.item.id), ["a", "b"]);
check("submitted is left out", plan([item("a", { status: "submitted" })]).jobs.length, 0);
check("already past its due time is left out", plan([item("a", { dueAt: D(12).getTime() })]).jobs.length, 0);
check("reminders switched to None are left out and not counted as skipped", [plan([item("a", { reminder: { mode: "none" } })]).jobs.length, plan([item("a", { reminder: { mode: "none" } })]).skipped], [0, 0]);
check("already has reminders is left out", plan([item("a", { calendar: { events: [{ kind: "due", id: "abcde001" }] } })]).jobs.length, 0);
check("a calendar note with no events still counts as missing", plan([item("a", { calendar: { events: [] } })]).jobs.length, 1);
check("no due date is left out", plan([item("a", { dueAt: null })]).jobs.length, 0);
check("an old assignment without a reminder choice uses the default", plan([item("a", { reminder: undefined })]).jobs.length, 1);
check("custom reminder is kept", plan([item("a", { reminder: { mode: "custom", minutes: [1440, 30] } })]).jobs[0].request.dueMinutes, [1440, 30]);

// ---------- order, skipping, the cap
p = plan([item("late", { dueAt: D(25).getTime() }), item("soon", { dueAt: D(14).getTime() }), item("mid", { dueAt: D(18).getTime() })]);
check("earliest due first", p.jobs.map((j) => j.item.id), ["soon", "mid", "late"]);
p = plan([item("a", { dueAt: D(14, 9, 0).getTime(), reminder: { mode: "custom", minutes: [2880] } }), item("b")]);
check("no reminder time ahead is skipped and counted", [p.jobs.map((j) => j.item.id), p.skipped], [["b"], 1]);
const many = Array.from({ length: 70 }, (_, i) => item("x" + String(i).padStart(2, "0"), { dueAt: D(14, 8, i).getTime() }));
p = plan(many);
check("at most 50 per press", [p.jobs.length, p.remaining, BACKFILL_MAX], [50, 20, 50]);
check("the earliest 50 come first", [p.jobs[0].item.id, p.jobs[49].item.id], ["x00", "x49"]);
check("a smaller cap", [plan(many, { max: 5 }).jobs.length, plan(many, { max: 5 }).remaining], [5, 65]);
check("empty", plan([]), { jobs: [], skipped: 0, remaining: 0 });

// ---------- the request is what the Worker accepts
const req = plan([item("a", { title: "Chapter 5 Essay" })]).jobs[0].request;
check("request carries id, title, course and zone", [req.assignmentId, req.title, req.courseName, req.timeZone], ["a", "Chapter 5 Essay", "Biology", "Africa/Lagos"]);
check("Worker accepts it", parseEventsRequest(JSON.parse(JSON.stringify(req)), now.getTime()).ok, true);
check("unknown course gives an empty name", plan([item("a", { courseId: "gone" })]).jobs[0].request.courseName, "");

// ---------- running
const err = (code) => Object.assign(new Error(code), { code });
function fakeClient(handler) {
  const log = [];
  return { log, createEvents: async (r) => { log.push(r.assignmentId); return handler(r, log.length); }, deleteEvents: async () => 0 };
}
const events = (r) => [{ kind: "due", id: "abcde" + r.assignmentId }];
const jobs = plan([item("a"), item("b"), item("c")]).jobs;

let saved = [];
let progress = [];
let c = fakeClient((r) => events(r));
let out = await runBackfill({ client: c, jobs, saveEvents: async (job, ev) => { saved.push([job.item.id, ev[0].id]); }, onProgress: (n, t) => progress.push([n, t]) });
check("all added", [out.added, out.stopped, out.total], [3, null, 3]);
check("each was recorded on its own assignment", saved, [["a", "abcdea"], ["b", "abcdeb"], ["c", "abcdec"]]);
check("progress is reported", progress, [[1, 3], [2, 3], [3, 3]]);

saved = [];
c = fakeClient((r, n) => { if (n === 2) throw err("reconnect"); return events(r); });
out = await runBackfill({ client: c, jobs, saveEvents: async (job) => { saved.push(job.item.id); } });
check("stops at a reconnect and keeps what was done", [out.added, out.stopped, saved, c.log], [1, "reconnect", ["a"], ["a", "b"]]);
c = fakeClient((r, n) => { if (n === 1) throw err("not_connected"); return events(r); });
check("not connected stops at once", (await runBackfill({ client: c, jobs, saveEvents: async () => {} })).stopped, "notconnected");
c = fakeClient((r, n) => { if (n === 3) throw err("network"); return events(r); });
out = await runBackfill({ client: c, jobs, saveEvents: async () => {} });
check("a network problem stops it", [out.added, out.stopped], [2, "failed"]);
c = fakeClient((r) => events(r));
out = await runBackfill({ client: c, jobs, saveEvents: async (job) => { if (job.item.id === "b") throw new Error("firestore down"); } });
check("a recording failure stops it (and the Worker events are taken back)", [out.added, out.stopped], [1, "failed"]);
c = fakeClient(() => []);
out = await runBackfill({ client: c, jobs, saveEvents: async () => {} });
check("no events back means nothing added, and it carries on", [out.added, out.stopped, c.log.length], [0, null, 3]);
check("no jobs, no calls", [(await runBackfill({ client: fakeClient(() => []), jobs: [], saveEvents: async () => {} })).total], [0]);

// ---------- the sentences
check("done", backfillMessage({ added: 12, skipped: 0, remaining: 0 }), { kind: "done", text: "Added reminders to 12 assignments." });
check("done, one", backfillMessage({ added: 1 }).text, "Added reminders to 1 assignment.");
check("done with skipped and more waiting", backfillMessage({ added: 12, skipped: 2, remaining: 20 }).text, "Added reminders to 12 assignments. 2 were skipped because they have no reminder time ahead. 20 more are waiting. Press the button again.");
check("one skipped, one waiting", backfillMessage({ added: 3, skipped: 1, remaining: 1 }).text, "Added reminders to 3 assignments. 1 was skipped because it has no reminder time ahead. 1 more is waiting. Press the button again.");
check("everything already has reminders", backfillMessage({ added: 0 }).text, "All your open assignments already have reminders.");
check("only skipped", backfillMessage({ added: 0, skipped: 2 }).text, "Nothing to add. 2 were skipped because they have no reminder time ahead.");
check("stopped: reconnect", backfillMessage({ added: 5, stopped: "reconnect" }), { kind: "problem", text: "Stopped after 5 assignments. Reconnect Google Calendar, then press the button again." });
check("stopped before anything", backfillMessage({ added: 0, stopped: "reconnect" }).text.startsWith("Nothing was added."), true);
check("stopped: not connected", backfillMessage({ added: 0, stopped: "notconnected" }).text.includes("not connected"), true);
check("stopped: could not be reached", backfillMessage({ added: 1, stopped: "failed" }).text, "Stopped after 1 assignment, because Google Calendar could not be reached. Try again in a moment.");

console.log(failed ? failed + " FAILED" : "ALL PASSED");
process.exit(failed ? 1 : 0);
