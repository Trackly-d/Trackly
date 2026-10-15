import { planReminders } from "../js/reminders.js";

let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(ok ? "PASS" : "FAIL", name, ok ? "" : "got " + JSON.stringify(got) + " want " + JSON.stringify(want));
};
const t = (d) => (d ? d.getTime() : null);
const D = (day, h = 0, m = 0) => new Date(2026, 9, day, h, m); // October 2026, device time

// Now: Monday 12 Oct, 10:00
const now = D(12, 10, 0);

let p = planReminders({ dueAt: D(24, 23, 59), now });
check("default: daily starts the day after", t(p.daily.first), t(D(13, 8)));
check("default: daily ends the day before the due day", t(p.daily.last), t(D(23, 8)));
check("default: eleven daily rings", p.daily.count, 11);
check("default: four due day reminders", p.due.minutes, [120, 60, 30, 0]);
check("default: due event is at the due time", t(p.due.at), t(D(24, 23, 59)));

p = planReminders({ dueAt: D(13, 15, 0), now });
check("due tomorrow: no daily (no day in between)", p.daily, null);
check("due tomorrow: all four due day reminders", p.due.minutes, [120, 60, 30, 0]);

p = planReminders({ dueAt: D(14, 15, 0), now });
check("due in two days: one daily ring (tomorrow)", [t(p.daily.first), t(p.daily.last), p.daily.count], [t(D(13, 8)), t(D(13, 8)), 1]);

p = planReminders({ dueAt: D(12, 11, 30), now });
check("due in 90 minutes: only reminders still ahead", p.due.minutes, [60, 30, 0]);
check("due in 90 minutes: no daily", p.daily, null);

p = planReminders({ dueAt: D(12, 10, 10), now });
check("due in 10 minutes: only the exact time", p.due.minutes, [0]);

check("due moment already passed: empty plan", planReminders({ dueAt: D(12, 9, 0), now }).due, null);
check("due exactly now: empty plan", planReminders({ dueAt: D(12, 10, 0), now }).due, null);

p = planReminders({ dueAt: D(13, 9, 0), now: D(12, 23, 0) });
check("added late at night, due next morning: no daily", p.daily, null);
p = planReminders({ dueAt: D(16, 9, 0), now: D(12, 23, 0) });
check("added late at night: daily starts next morning", [t(p.daily.first), t(p.daily.last)], [t(D(13, 8)), t(D(15, 8))]);

p = planReminders({ dueAt: D(24, 23, 59), now, mode: "custom", minutes: [1440, 30] });
check("custom: no daily", p.daily, null);
check("custom: only chosen times, biggest first", p.due.minutes, [1440, 30]);

p = planReminders({ dueAt: D(13, 9, 0), now, mode: "custom", minutes: [1440, 30] });
check("custom: a reminder already in the past is dropped", p.due.minutes, [30]);

p = planReminders({ dueAt: D(13, 9, 0), now, mode: "custom", minutes: [2880] });
check("custom: nothing left ahead gives no event", p.due, null);

p = planReminders({ dueAt: D(24, 23, 59), now, mode: "none" });
check("none: nothing at all", [p.daily, p.due], [null, null]);

check("duplicates and junk ignored", planReminders({ dueAt: D(24, 23, 59), now, mode: "custom", minutes: [30, 30, "x", -5] }).due.minutes, [30]);
check("different daily hour", t(planReminders({ dueAt: D(24, 23, 59), now, dailyHour: 7 }).daily.first), t(D(13, 7)));

console.log(failed ? failed + " FAILED" : "ALL PASSED");
process.exit(failed ? 1 : 0);
