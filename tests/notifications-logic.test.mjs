import {
  normalizeAlertHours, alertSettingsFrom, validateAlertSettings, deriveAlerts, activityEntry, buildNotificationItems,
  isUnread, markRead, markAllRead, hasUnread, filterItems, pageSlice, emptyMessage, timeAgo, EMPTY_READ, PAGE_SIZE
} from "../js/notifications-logic.js";

let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(ok ? "PASS" : "FAIL", name, ok ? "" : "got " + JSON.stringify(got) + " want " + JSON.stringify(want));
};

const H = 3600000, D = 24 * H;
const now = new Date(2026, 9, 17, 10, 0);        // Sat 17 Oct 2026, 10:00
const N = now.getTime();
const A = (id, extra = {}) => ({ id, title: "Task " + id, courseId: "c1", status: "pending", dueAt: N + 20 * H, createdAt: N - 5 * D, ...extra });
const hours = [48, 24, 3];

// ---------- settings
check("alert hours cleaned", normalizeAlertHours([24, 48, 99, "3", 24]), [48, 24, 3]);
check("no saved choice gives the default", normalizeAlertHours(undefined), [48, 24]);
check("an empty choice stays empty", normalizeAlertHours([]), []);
check("settings default", alertSettingsFrom({}), { alertsEnabled: true, alertHours: [48, 24] });
check("settings saved", alertSettingsFrom({ alertsEnabled: false, alertHours: [3] }), { alertsEnabled: false, alertHours: [3] });
check("alerts on with no times is refused", validateAlertSettings({ alertsEnabled: true, alertHours: [] }).ok, false);
check("alerts off with no times is fine", validateAlertSettings({ alertsEnabled: false, alertHours: [] }).ok, true);
check("alerts on with times is fine", validateAlertSettings({ alertsEnabled: true, alertHours: [24] }).value, { alertsEnabled: true, alertHours: [24] });

// ---------- due soon alerts
let alerts = deriveAlerts({ assignments: [A("a")], now, alertHours: hours });
check("due in 20 hours: one alert, the tightest time passed (24)", [alerts.length, alerts[0].type, alerts[0].title, alerts[0].time], [1, "reminder", "Task a is due in 24 hours", N - 4 * H]);
check("due in 60 hours: no alert yet", deriveAlerts({ assignments: [A("a", { dueAt: N + 60 * H })], now, alertHours: hours }), []);
check("due in 2 hours: the 3 hour alert", deriveAlerts({ assignments: [A("a", { dueAt: N + 2 * H })], now, alertHours: hours })[0].title, "Task a is due in 3 hours");
check("only 48 chosen: the 48 hour alert", deriveAlerts({ assignments: [A("a")], now, alertHours: [48] })[0].title, "Task a is due in 48 hours");
check("a time that passed before the assignment was added gives no alert", deriveAlerts({ assignments: [A("a", { dueAt: N + 40 * H, createdAt: N - H })], now, alertHours: hours }), []);
check("added 10 hours before it is due, 3 hour alert still comes later", deriveAlerts({ assignments: [A("a", { dueAt: N + 2 * H, createdAt: N - 8 * H })], now, alertHours: hours })[0].title, "Task a is due in 3 hours");
check("submitted gives no alert", deriveAlerts({ assignments: [A("a", { status: "submitted" })], now, alertHours: hours }), []);
check("in progress gives an alert", deriveAlerts({ assignments: [A("a", { status: "in_progress" })], now, alertHours: hours }).length, 1);
check("the same assignment twice gives one alert", deriveAlerts({ assignments: [A("a"), A("a")], now, alertHours: hours }).length, 1);
check("a new due date is a new alert (different key)", deriveAlerts({ assignments: [A("a")], now, alertHours: hours })[0].key !== deriveAlerts({ assignments: [A("a", { dueAt: N + 21 * H })], now, alertHours: hours })[0].key, true);
check("no due date gives nothing", deriveAlerts({ assignments: [A("a", { dueAt: null })], now, alertHours: hours }), []);
check("an assignment without createdAt still gets alerts", deriveAlerts({ assignments: [A("a", { createdAt: undefined })], now, alertHours: hours }).length, 1);

// ---------- overdue
alerts = deriveAlerts({ assignments: [A("o", { dueAt: N - 5 * H })], now, alertHours: hours });
check("overdue alert", [alerts[0].type, alerts[0].title, alerts[0].time], ["overdue", "Task o is overdue", N - 5 * H]);
check("overdue more than 30 days ago is left out", deriveAlerts({ assignments: [A("o", { dueAt: N - 40 * D })], now, alertHours: hours }), []);
check("overdue and submitted is not overdue", deriveAlerts({ assignments: [A("o", { dueAt: N - 5 * H, status: "submitted" })], now, alertHours: hours }), []);

// ---------- activity entries
const entry = activityEntry("added", { assignmentId: "a1", title: "x".repeat(300), courseTitle: "Biology" }, 1000);
check("added entry id is stable per assignment", entry.id, "added_a1");
check("title is cut to 120 characters", entry.data.title.length, 120);
check("submitted entry id includes the moment", activityEntry("submitted", { assignmentId: "a1", title: "T" }, 1234).id, "submitted_a1_1234");

// ---------- the list
const activity = [
  { id: "added_x", type: "added", assignmentId: "x", title: "Macro Problem Set", courseTitle: "Microeconomics", createdAt: N - 20 * H },
  { id: "submitted_y_1", type: "submitted", assignmentId: "y", title: "Regression", courseTitle: "Statistics", createdAt: N - 5 * D },
  { id: "junk", type: "weird", title: "?", createdAt: N - H },
  { id: "old", type: "added", assignmentId: "z", title: "Old", courseTitle: "", createdAt: N - 40 * D }
];
const settings = { alertsEnabled: true, alertHours: hours, read: EMPTY_READ };
const names = new Map([["c1", "Introduction to Biology"]]);
let items = buildNotificationItems({ settings, assignments: [A("a"), A("o", { dueAt: N - 5 * H })], activity, courseNames: names, now });
check("newest first (due soon happened 4h ago, overdue 5h ago)", items.map((i) => i.key.split(":")[0]), ["a", "o", "added_x", "submitted_y_1"]);
check("types", items.map((i) => i.type), ["reminder", "overdue", "added", "submitted"]);
check("course names come from the course list or the saved title", items.map((i) => i.courseName), ["Introduction to Biology", "Introduction to Biology", "Microeconomics", "Statistics"]);
check("added and submitted wording", [items[2].title, items[3].title], ["Macro Problem Set added", "Regression marked as submitted"]);
check("junk types and old items are left out", items.some((i) => i.key === "junk" || i.key === "old"), false);
check("everything starts unread", items.every((i) => i.unread), true);
check("alerts off hides alerts but keeps the history", buildNotificationItems({ settings: { ...settings, alertsEnabled: false }, assignments: [A("a")], activity, now }).map((i) => i.type), ["added", "submitted"]);

// ---------- read and unread
const target = items[1];
let read = markRead(EMPTY_READ, target, N);
check("one item read", [isUnread(target, read), isUnread(items[0], read)], [false, true]);
check("reading one keeps the others unread", buildNotificationItems({ settings: { ...settings, read }, assignments: [A("a"), A("o", { dueAt: N - 5 * H })], activity, now }).filter((i) => i.unread).length, 3);
read = markAllRead(N);
check("mark all read", [items.every((i) => !isUnread(i, read)), read.keys], [true, {}]);
check("a new item after mark all is unread", isUnread({ key: "n", time: N + 1000 }, read), true);
check("an item at exactly the moment is read", isUnread({ key: "n", time: N }, read), false);
const stale = markRead({ allBefore: 0, keys: { old: N - 40 * D } }, target, N);
check("old read marks are dropped", [Object.keys(stale.keys).includes("old"), Object.keys(stale.keys).includes(target.key)], [false, true]);
check("hasUnread", [hasUnread(items), hasUnread(items.map((i) => ({ ...i, unread: false })))], [true, false]);

// ---------- filters and pages
const mixed = buildNotificationItems({ settings, assignments: [A("a"), A("o", { dueAt: N - 5 * H })], activity, courseNames: names, now });
check("filter reminders", filterItems(mixed, "reminders").map((i) => i.type), ["reminder"]);
check("filter overdue", filterItems(mixed, "overdue").map((i) => i.type), ["overdue"]);
check("filter added", filterItems(mixed, "added").length, 1);
check("filter submitted", filterItems(mixed, "submitted").length, 1);
check("filter all", filterItems(mixed, "all").length, 4);
check("filter unread follows read state", filterItems(mixed.map((i, k) => ({ ...i, unread: k === 0 })), "unread").length, 1);
const fifty = Array.from({ length: 45 }, (_, i) => ({ key: "k" + i }));
check("20 rows at first, more waiting", [PAGE_SIZE, pageSlice(fifty).shown.length, pageSlice(fifty).hasMore, pageSlice(fifty).remaining], [20, 20, true, 25]);
check("show more adds 20", pageSlice(fifty, 40).shown.length, 40);
check("the last page has no more", [pageSlice(fifty, 60).hasMore, pageSlice(fifty, 60).shown.length], [false, 45]);
check("empty words differ per filter", ["all", "unread", "reminders", "overdue", "added", "submitted"].map((f) => emptyMessage(f).title).length, 6);
check("empty words for all", emptyMessage("all").title, "You are all caught up");

// ---------- time words
check("just now", timeAgo(N - 30000, now), "Just now");
check("minutes", timeAgo(N - 5 * 60000, now), "5m ago");
check("hours today", timeAgo(new Date(2026, 9, 17, 8, 0).getTime(), now), "2h ago");
check("yesterday", timeAgo(new Date(2026, 9, 16, 23, 0).getTime(), now), "Yesterday");
check("earlier this month", timeAgo(new Date(2026, 9, 12, 11, 5).getTime(), now), "Oct 12");
check("another year shows the year", timeAgo(new Date(2025, 9, 12, 11, 5).getTime(), now), "Oct 12, 2025");

console.log(failed ? failed + " FAILED" : "ALL PASSED");
process.exit(failed ? 1 : 0);
