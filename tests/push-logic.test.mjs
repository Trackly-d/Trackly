import { normalizeTypes, normalizeHours, nextAlarm, pushText, watchItem, pushSupport, urlBase64ToBytes, switchId, TYPE_KEYS, EVENT_KINDS, HOUR } from "../js/push-logic.js";
import { deriveAlerts } from "../js/notifications-logic.js";

let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(ok ? "PASS" : "FAIL", name, ok ? "" : "got " + JSON.stringify(got) + " want " + JSON.stringify(want));
};

// ---------- the kinds of push
check("a new student gets the four useful kinds on", Object.entries(normalizeTypes({})).filter(([, on]) => on).map(([k]) => k), ["due", "overdue", "added", "submitted"]);
check("every kind is always present", Object.keys(normalizeTypes(null)), TYPE_KEYS);
check("odd values fall back to the default", normalizeTypes({ added: "yes", due: false, bogus: true }).added, true);
check("a switched off kind stays off", normalizeTypes({ due: false }).due, false);
check("there is no course deleted kind (the app cannot delete a course)", TYPE_KEYS.includes("course_deleted"), false);
check("event kinds leave out the two timed ones", EVENT_KINDS.includes("due") || EVENT_KINDS.includes("overdue"), false);
check("page switch ids", [switchId("due"), switchId("course_added")], ["st-push-due", "st-push-course-added"]);

check("alert times: sorted, only 3, 24 and 48", normalizeHours([24, 3, 99, "48", 24]), [48, 24, 3]);
check("alert times: default when missing", normalizeHours(undefined), [48, 24]);

// ---------- when to send (must match the in-app alerts exactly)
const due = Date.UTC(2026, 9, 30, 12, 0, 0);
const created = due - 100 * HOUR;
check("first alarm is the 48 hour one", nextAlarm({ dueMs: due, createdMs: created, hours: [48, 24], after: created }), { at: due - 48 * HOUR, kind: "due", hours: 48 });
check("then the 24 hour one", nextAlarm({ dueMs: due, createdMs: created, hours: [48, 24], after: due - 48 * HOUR }).hours, 24);
check("then overdue", nextAlarm({ dueMs: due, createdMs: created, hours: [48, 24], after: due - 24 * HOUR }), { at: due, kind: "overdue", hours: 0 });
check("then nothing", nextAlarm({ dueMs: due, createdMs: created, hours: [48, 24], after: due }), null);
check("alerts off means no alarms at all", nextAlarm({ dueMs: due, createdMs: created, hours: [48], enabled: false, after: created }), null);
check("times before the assignment existed are skipped", nextAlarm({ dueMs: due, createdMs: due - 10 * HOUR, hours: [48, 24, 3], after: due - 10 * HOUR }).hours, 3);

// the push at any moment must agree with what the Notifications page would show
let agree = true;
for (const hours of [[48, 24], [3], [48, 24, 3], [24]]) {
  for (const makeBefore of [100, 30, 10, 2]) {
    const c = due - makeBefore * HOUR;
    const fired = [];
    let after = c;
    for (let i = 0; i < 6; i++) { const n = nextAlarm({ dueMs: due, createdMs: c, hours, after }); if (!n) break; fired.push(n); after = n.at; }
    for (let t = c; t < due; t += 30 * 60000) {
      const shown = deriveAlerts({ assignments: [{ id: "a", status: "pending", dueAt: due, createdAt: c, title: "T" }], now: t, alertHours: hours }).filter((x) => x.type === "reminder");
      const lastFired = fired.filter((f) => f.kind === "due" && f.at <= t).slice(-1)[0];
      const wantHours = lastFired ? lastFired.hours : null;
      const gotHours = shown.length ? Number(/in (\d+) hours/.exec(shown[0].title)[1]) : null;
      if (wantHours !== gotHours) agree = false;
    }
  }
}
check("push and the in-app alert always agree on which due soon alert applies", agree, true);
check("at the due moment both switch to overdue",
  [deriveAlerts({ assignments: [{ id: "a", status: "pending", dueAt: due, createdAt: created, title: "T" }], now: due, alertHours: [48, 24] }).map((x) => x.type), nextAlarm({ dueMs: due, createdMs: created, hours: [48, 24], after: due - HOUR }).kind],
  [["overdue"], "overdue"]);

// ---------- the words
check("due soon text", pushText("due", { id: "a1", name: "Chapter 5 Essay", courseName: "Biology", hours: 24 }), { title: "Chapter 5 Essay is due in 24 hours", body: "Course: Biology", url: "/assignment.html?id=a1", tag: "due:a1:24" });
check("overdue text", pushText("overdue", { id: "a1", name: "Essay" }).title, "Essay is overdue");
check("deleted text goes to the list, not a missing page", pushText("deleted", { id: "a1", name: "Essay" }).url, "/assignments.html");
check("course text opens the course", pushText("course_added", { id: "c1", name: "Statistics" }), { title: "Statistics course added", body: "Open Trackly to see your courses.", url: "/course.html?id=c1", tag: "course_added:c1" });
check("an odd id cannot break out of the link", pushText("added", { id: "a b/../x", name: "T" }).url, "/assignment.html?id=a%20b%2F..%2Fx");
check("control characters are cleaned and long titles cut", [pushText("added", { id: "a", name: "A\nB\u0007C" }).title, pushText("added", { id: "a", name: "x".repeat(500) }).title.length], ["A B C added", 126]);
check("every event kind has text", EVENT_KINDS.every((k) => pushText(k, { id: "x", name: "T" })), true);
check("an unknown kind has no text", pushText("nope", {}), null);

// ---------- what is sent for an assignment
const toMs = (v) => (v ? new Date(v).getTime() : 0);
const rec = { id: "a1", title: "  Lab   Report ", dueAt: "2026-11-01T10:00:00Z", createdAt: "2026-10-20T08:00:00Z", status: "in_progress" };
check("an open assignment is watched", watchItem(rec, "Chem", toMs), { assignmentId: "a1", title: "Lab Report", courseName: "Chem", dueAt: "2026-11-01T10:00:00.000Z", createdAt: "2026-10-20T08:00:00.000Z", status: "open" });
check("a submitted one is closed", watchItem({ ...rec, status: "submitted" }, "", toMs).status, "closed");
check("no due date means nothing to watch", watchItem({ ...rec, dueAt: null }, "", toMs), null);

// ---------- can this browser do push
const base = { hasServiceWorker: true, hasPushManager: true, hasNotification: true, permission: "default" };
check("a normal browser is fine", pushSupport(base), "ok");
check("iPhone in Safari must install first", pushSupport({ ...base, isIos: true }), "ios");
check("iPhone from the Home Screen is fine", pushSupport({ ...base, isIos: true, standalone: true }), "ok");
check("no service worker support", pushSupport({ ...base, hasServiceWorker: false }), "unsupported");
check("no push support", pushSupport({ ...base, hasPushManager: false }), "unsupported");
check("permission already refused", pushSupport({ ...base, permission: "denied" }), "blocked");
check("the public key becomes bytes", [...urlBase64ToBytes("AQID")], [1, 2, 3]);

console.log(failed ? failed + " FAILED" : "ALL PASSED");
process.exit(failed ? 1 : 0);
