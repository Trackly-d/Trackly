import { buildCalendarRequest, eventIdsOf, calendarField, needsRebuild, createReminders, removeReminders, runCleanup, reminderNotice } from "../js/calendar-sync.js";
import { parseEventsRequest, buildEvents } from "../worker-calendar/lib.js";

let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(ok ? "PASS" : "FAIL", name, ok ? "" : "got " + JSON.stringify(got) + " want " + JSON.stringify(want));
};

// Now: Tue 13 Oct 2026, 10:00 (local time)
const now = new Date(2026, 9, 13, 10, 0);
const D = (day, h = 0, m = 0) => new Date(2026, 9, day, h, m);
const base = { assignmentId: "a1", title: "Chapter 5 Essay", courseName: "Biology", timeZone: "Africa/Lagos", now };

// ---------- the request the website sends
let req = buildCalendarRequest({ ...base, dueAt: D(24, 23, 59), reminder: { mode: "default" } });
check("default: four due day reminders", req.dueMinutes, [120, 60, 30, 0]);
check("default: daily from tomorrow 8:00", [req.daily.first, req.daily.count], [D(14, 8).toISOString(), 10]);
check("due moment as ISO", req.due, D(24, 23, 59).toISOString());
check("carries title, course, zone", [req.title, req.courseName, req.timeZone, req.assignmentId], ["Chapter 5 Essay", "Biology", "Africa/Lagos", "a1"]);

req = buildCalendarRequest({ ...base, dueAt: D(14, 15, 0), reminder: { mode: "default" } });
check("due tomorrow: no daily series", req.daily, null);
req = buildCalendarRequest({ ...base, dueAt: D(24, 23, 59), reminder: { mode: "custom", minutes: [1440, 30] } });
check("custom: only the chosen times, no daily", [req.dueMinutes, req.daily], [[1440, 30], null]);
check("none: nothing to ask for", buildCalendarRequest({ ...base, dueAt: D(24, 23, 59), reminder: { mode: "none" } }), null);
check("due already passed: nothing", buildCalendarRequest({ ...base, dueAt: D(13, 9, 0), reminder: { mode: "default" } }), null);
check("every custom time already passed: nothing", buildCalendarRequest({ ...base, dueAt: D(14, 9, 0), reminder: { mode: "custom", minutes: [2880] } }), null);
check("old assignment without a reminder uses the default", buildCalendarRequest({ ...base, dueAt: D(24, 23, 59), reminder: undefined }).dueMinutes, [120, 60, 30, 0]);

// the Worker must accept exactly what this builds, in every mode
const nowMs = now.getTime();
for (const [label, reminder, due] of [["default far", { mode: "default" }, D(24, 23, 59)], ["default near", { mode: "default" }, D(13, 15, 0)], ["custom", { mode: "custom", minutes: [0, 30, 60, 120, 1440] }, D(24, 23, 59)], ["default 2 days", { mode: "default" }, D(15, 9, 0)]]) {
  const r = buildCalendarRequest({ ...base, dueAt: due, reminder });
  const parsed = parseEventsRequest(JSON.parse(JSON.stringify(r)), nowMs);
  check("Worker accepts the request: " + label, parsed.ok, true);
  const kinds = buildEvents(parsed.value, "http://localhost:5500").map((e) => e.kind);
  check("Worker builds the events: " + label, kinds.length >= 1, true);
}

// ---------- saved fields
check("event ids", eventIdsOf({ events: [{ kind: "due", id: "abcde001" }, { kind: "daily", id: "abcde002" }] }), ["abcde001", "abcde002"]);
check("no calendar field", [eventIdsOf(null), eventIdsOf(undefined), eventIdsOf({}), eventIdsOf({ events: "x" })], [[], [], [], []]);
check("calendar field shape", calendarField([{ kind: "due", id: "abcde001", extra: 1 }], "Africa/Lagos"), { events: [{ kind: "due", id: "abcde001" }], timeZone: "Africa/Lagos" });

// ---------- does an edit need new events?
const saved = { title: "Essay", courseId: "c1", dueAt: D(24, 23, 59).getTime(), reminder: { mode: "default" }, description: "notes" };
const same = { title: "Essay", courseId: "c1", dueAt: D(24, 23, 59), reminder: { mode: "default" } };
check("nothing changed", needsRebuild(saved, same), false);
check("old assignment without reminder equals default", needsRebuild({ ...saved, reminder: undefined }, same), false);
check("title changed", needsRebuild(saved, { ...same, title: "Essay 2" }), true);
check("course changed", needsRebuild(saved, { ...same, courseId: "c2" }), true);
check("due changed", needsRebuild(saved, { ...same, dueAt: D(25, 23, 59) }), true);
check("reminder mode changed", needsRebuild(saved, { ...same, reminder: { mode: "none" } }), true);
check("custom minutes changed", needsRebuild({ ...saved, reminder: { mode: "custom", minutes: [30] } }, { ...same, reminder: { mode: "custom", minutes: [30, 60] } }), true);
check("custom minutes same in another order", needsRebuild({ ...saved, reminder: { mode: "custom", minutes: [60, 30] } }, { ...same, reminder: { mode: "custom", minutes: [30, 60] } }), false);
check("due as a Firestore style timestamp", needsRebuild({ ...saved, dueAt: { toDate: () => D(24, 23, 59) } }, same), false);

// ---------- pretend client
const err = (code) => Object.assign(new Error(code), { code });
function fakeClient({ create, remove } = {}) {
  const log = { created: [], deleted: [] };
  return { log, createEvents: async (r) => { log.created.push(r); if (create instanceof Error) throw create; return create || []; }, deleteEvents: async (ids) => { log.deleted.push(ids); if (remove instanceof Error) throw remove; return ids.length; } };
}
const made = [{ kind: "due", id: "abcde001" }, { kind: "daily", id: "abcde002" }];

// ---------- creating
let saves = [];
let c = fakeClient({ create: made });
let out = await createReminders({ client: c, request: { assignmentId: "a1" }, saveEvents: async (e) => { saves.push(e); } });
check("created and recorded", [out.result, saves.length, out.events.length], ["ok", 1, 2]);
c = fakeClient({ create: made });
out = await createReminders({ client: c, request: null, saveEvents: async () => { throw new Error("must not run"); } });
check("nothing to ask for: no call at all", [out.result, c.log.created.length], ["none", 0]);
out = await createReminders({ client: fakeClient({ create: [] }), request: {}, saveEvents: async () => {} });
check("no events came back", out.result, "none");
out = await createReminders({ client: fakeClient({ create: err("reconnect") }), request: {}, saveEvents: async () => {} });
check("reconnect needed", out.result, "reconnect");
out = await createReminders({ client: fakeClient({ create: err("not_connected") }), request: {}, saveEvents: async () => {} });
check("not connected", out.result, "notconnected");
out = await createReminders({ client: fakeClient({ create: err("network") }), request: {}, saveEvents: async () => {} });
check("network problem", out.result, "failed");
out = await createReminders({ client: fakeClient({ create: new Error("weird") }), request: {}, saveEvents: async () => {} });
check("any other problem", out.result, "failed");
c = fakeClient({ create: made });
out = await createReminders({ client: c, request: {}, saveEvents: async () => { throw new Error("firestore down"); } });
check("events that could not be recorded are taken back", [out.result, c.log.deleted], ["failed", [["abcde001", "abcde002"]]]);
c = fakeClient({ create: made, remove: err("network") });
out = await createReminders({ client: c, request: {}, saveEvents: async () => { throw new Error("x"); } });
check("take back failing still reports a failure, not a crash", out.result, "failed");

// ---------- removing
let queued = [];
c = fakeClient();
out = await removeReminders({ client: c, eventIds: ["abcde001"], queueCleanup: async (ids) => { queued.push(ids); } });
check("removed", [out.result, c.log.deleted, queued.length], ["ok", [["abcde001"]], 0]);
c = fakeClient();
out = await removeReminders({ client: c, eventIds: [], queueCleanup: async () => {} });
check("nothing to remove: no call", [out.result, c.log.deleted.length], ["none", 0]);
c = fakeClient({ remove: err("network") });
out = await removeReminders({ client: c, eventIds: ["abcde001", "abcde002"], queueCleanup: async (ids) => { queued.push(ids); } });
check("cannot remove now: queued for later", [out.result, queued[0]], ["queued", ["abcde001", "abcde002"]]);
out = await removeReminders({ client: fakeClient({ remove: err("reconnect") }), eventIds: ["abcde001"], queueCleanup: async () => { throw new Error("firestore down"); } });
check("cannot remove and cannot queue", out.result, "failed");

// ---------- finishing queued removals
const items = [{ id: "a1", eventIds: ["abcde001"] }, { id: "a2", eventIds: ["abcde002"] }, { id: "a3", eventIds: ["abcde003"] }];
let finished = [];
c = fakeClient();
check("all finished", [await runCleanup({ client: c, items, finish: async (id) => { finished.push(id); } }), finished], [3, ["a1", "a2", "a3"]]);
finished = [];
let calls = 0;
const flaky = { deleteEvents: async () => { calls++; if (calls === 2) throw err("reconnect"); return 1; } };
check("stops when Calendar needs a reconnect", [await runCleanup({ client: flaky, items, finish: async (id) => { finished.push(id); } }), finished, calls], [1, ["a1"], 2]);
finished = []; calls = 0;
const oneBad = { deleteEvents: async () => { calls++; if (calls === 2) throw err("google"); return 1; } };
check("one bad item does not block the rest", [await runCleanup({ client: oneBad, items, finish: async (id) => { finished.push(id); } }), finished], [2, ["a1", "a3"]]);

// ---------- sentences
check("notice: not connected", reminderNotice("notconnected").includes("Connect Google Calendar"), true);
check("notice: reconnect", reminderNotice("reconnect").includes("Reconnect"), true);
check("notice: failed", reminderNotice("failed").includes("Edit the assignment"), true);
check("notice: fine means nothing", [reminderNotice("ok"), reminderNotice("none"), reminderNotice(null), reminderNotice("hacked")], ["", "", "", ""]);

console.log(failed ? failed + " FAILED" : "ALL PASSED");
process.exit(failed ? 1 : 0);
