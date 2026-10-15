/* ==========================================================
   TRACKLY reminder plan (pure logic, no Google, no Firebase, tested without a browser)
   Says WHEN reminders should ring. A later step turns the plan into Google Calendar events.

   Default schedule (decided with the developer):
     - once a day at 8:00 AM, starting the day after the assignment is added,
       until the day before it is due (a series, so it needs only one Calendar event)
     - on the due day: 2 hours, 1 hour and 30 minutes before, and at the exact due time
   Custom: only the times the student picked, before the due time, and no daily series.
   None: nothing.
   Reminders that would already be in the past are left out.
   All times are device time. Dates are real Date objects.
   ========================================================== */

export const DAILY_HOUR = 8;
export const DUE_DAY_MINUTES = [120, 60, 30, 0];

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const atHour = (d, h) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, 0);

/* Returns { mode, daily, due }
   daily: { first, last, count }  (first and last are the first and last 8:00 AM rings) or null
   due:   { at, minutes }         (minutes before the due time, biggest first) or null */
export function planReminders({ dueAt, now = new Date(), mode = "default", minutes = [], dailyHour = DAILY_HOUR }) {
  const plan = { mode, daily: null, due: null };
  if (mode === "none" || !(dueAt instanceof Date) || dueAt.getTime() <= now.getTime()) return plan;

  const stillAhead = (m) => dueAt.getTime() - m * 60000 > now.getTime();
  const wanted = mode === "custom"
    ? Array.from(new Set(minutes.map(Number))).filter((m) => Number.isFinite(m) && m >= 0)
    : DUE_DAY_MINUTES;
  const kept = wanted.filter(stillAhead).sort((a, b) => b - a);
  if (kept.length) plan.due = { at: dueAt, minutes: kept };

  if (mode === "default") {
    const first = atHour(addDays(startOfDay(now), 1), dailyHour);
    const last = atHour(addDays(startOfDay(dueAt), -1), dailyHour);
    if (first.getTime() <= last.getTime()) {
      const count = Math.round((startOfDay(last) - startOfDay(first)) / 86400000) + 1;
      plan.daily = { first, last, count };
    }
  }
  return plan;
}