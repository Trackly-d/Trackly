import { readFileSync, readdirSync } from "node:fs";
import { activityEntry, buildNotificationItems, filterItems, emptyMessage, FILTERS, ACTIVITY_TYPES } from "../js/notifications-logic.js";
import { TYPE_KEYS, EVENT_KINDS, COURSE_KINDS, switchId } from "../js/push-logic.js";

let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(ok ? "PASS" : "FAIL", name, ok ? "" : "got " + JSON.stringify(got) + " want " + JSON.stringify(want));
};
const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");

// ---------- how each kind is saved
const NOW = 1760000000000;
check("added is saved once per assignment", activityEntry("added", { assignmentId: "a1", title: "T" }, NOW).id, "added_a1");
check("submitted, started and edited each get their own entry", ["submitted", "started", "edited"].map((t) => activityEntry(t, { assignmentId: "a1", title: "T" }, NOW).id), ["submitted_a1_" + NOW, "started_a1_" + NOW, "edited_a1_" + NOW]);
check("a course added is saved once", activityEntry("course_added", { courseId: "c1", title: "Stats" }, NOW).id, "course_added_c1");
check("a course edit gets its own entry", activityEntry("course_edited", { courseId: "c1", title: "Stats" }, NOW).id, "course_edited_c1_" + NOW);
check("course entries carry the course id, assignment entries the assignment id", [activityEntry("course_added", { courseId: "c1", title: "S" }).data.courseId, activityEntry("course_added", { courseId: "c1", title: "S" }).data.assignmentId, activityEntry("edited", { assignmentId: "a1", title: "S" }).data.assignmentId], ["c1", undefined, "a1"]);
check("long titles are cut", activityEntry("added", { assignmentId: "a", title: "x".repeat(300), courseTitle: "y".repeat(300) }).data.title.length, 120);

// ---------- how they appear
const ts = (ms) => ({ toDate: () => new Date(ms) });
const docs = [
  { id: "d1", type: "started", assignmentId: "a1", title: "Essay", courseTitle: "Bio", createdAt: ts(NOW - 60000) },
  { id: "d2", type: "edited", assignmentId: "a1", title: "Essay", courseTitle: "Bio", createdAt: ts(NOW - 120000) },
  { id: "d3", type: "course_added", courseId: "c1", title: "Statistics", courseTitle: "", createdAt: ts(NOW - 180000) },
  { id: "d4", type: "course_edited", courseId: "c1", title: "Statistics", courseTitle: "", createdAt: ts(NOW - 240000) },
  { id: "d5", type: "added", assignmentId: "a2", title: "Lab", courseTitle: "Chem", createdAt: ts(NOW - 300000) },
  { id: "d6", type: "deleted", assignmentId: "a3", title: "Gone", createdAt: ts(NOW - 360000) },
  { id: "d7", type: "bogus", title: "X", createdAt: ts(NOW - 400000) }
];
const items = buildNotificationItems({ settings: { alertsEnabled: true, alertHours: [48, 24] }, assignments: [], activity: docs, now: NOW });
check("every kind is worded", items.map((i) => i.title), ["Essay started", "Essay edited", "Statistics course added", "Statistics course updated", "Lab added"]);
check("a kind we do not show (deleted, unknown) is ignored", items.length, 5);
check("course items link to the course, not an assignment", items.filter((i) => i.type.startsWith("course_")).map((i) => [i.courseId, i.assignmentId]), [["c1", ""], ["c1", ""]]);
check("course items show no course line", items.filter((i) => i.type.startsWith("course_")).map((i) => i.courseName), ["", ""]);
check("Updates shows started and edited", filterItems(items, "updates").map((i) => i.type), ["started", "edited"]);
check("Courses shows both course kinds", filterItems(items, "courses").map((i) => i.type), ["course_added", "course_edited"]);
check("Added still shows only added", filterItems(items, "added").map((i) => i.type), ["added"]);
check("every filter has an empty message", FILTERS.every((f) => emptyMessage(f).title.length > 3 && emptyMessage(f).text.length > 5), true);

// ---------- the page, the code and the Settings card agree
const notifPage = read("notifications.html");
check("the page offers exactly the filters the code knows", [...notifPage.matchAll(/data-filter="(\w+)"/g)].map((m) => m[1]), FILTERS);
check("the page's icons exist for every kind", ["play", "edit", "book", "bell", "alert", "calplus", "check"].every((n) => notifPage.includes('id="i-' + n + '"')), true);
const src = read("js/notifications.js");
check("every saved kind has an icon", ACTIVITY_TYPES.every((t) => new RegExp("\\b" + t + ": \"\\w+\"").test(src)), true);

const settingsPage = read("settings.html");
check("Settings has one switch for every kind of push, and no others", [...settingsPage.matchAll(/id="(st-push-[\w-]+)" aria-label/g)].map((m) => m[1]).sort(), TYPE_KEYS.map(switchId).sort());
check("every event kind a page sends is one the Worker accepts", EVENT_KINDS.length + 2, TYPE_KEYS.length);

// the pages only send kinds that exist
const sent = new Set();
for (const f of readdirSync(new URL("../js/", import.meta.url)).filter((n) => n.endsWith(".js"))) {
  for (const m of read("js/" + f).matchAll(/notifyPush\(\w+, "(\w+)"/g)) sent.add(m[1]);
  for (const m of read("js/" + f).matchAll(/notifyPush\(\w+, (editId \? "edited" : "added"|kind)/g)) { sent.add("edited"); sent.add("added"); }
}
check("every notifyPush call uses a real kind", [...sent].every((k) => EVENT_KINDS.includes(k)), true);
check("the pages send all seven kinds", EVENT_KINDS.filter((k) => !sent.has(k)), []);
check("deleting a course is not offered (the app cannot do it)", COURSE_KINDS, ["course_added", "course_edited"]);

console.log(failed ? failed + " FAILED" : "ALL PASSED");
process.exit(failed ? 1 : 0);
