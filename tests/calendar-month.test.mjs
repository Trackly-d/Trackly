import { dayKey, dateFromKey, buildMonthGrid, gridRange, monthLabel, shiftMonth, moveSelection, groupByDay, chipsFor, sideTitle, sideDate, dayAria, sameDay, STATUS_CLASS } from "../js/calendar-month.js";

let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(ok ? "PASS" : "FAIL", name, ok ? "" : "got " + JSON.stringify(got) + " want " + JSON.stringify(want));
};
const D = (m, d, h = 0, min = 0) => new Date(2026, m, d, h, min); // m is 0 to 11

// ---------- the grid for October 2026 (the 1st is a Thursday)
const grid = buildMonthGrid(2026, 9);
check("always 42 cells", grid.length, 42);
check("starts on the Sunday before", grid[0].key, "2026-09-27");
check("ends 41 days later", grid[41].key, "2026-11-07");
check("first of October is the fifth cell", [grid[4].key, grid[4].inMonth], ["2026-10-01", true]);
check("spill over days are not in the month", [grid[0].inMonth, grid[41].inMonth], [false, false]);
check("31 days are in the month", grid.filter((c) => c.inMonth).length, 31);
check("every row starts on a Sunday", [0, 7, 14, 21, 28, 35].every((i) => grid[i].date.getDay() === 0), true);
check("a month starting on a Sunday starts that day (Feb 2026)", buildMonthGrid(2026, 1)[0].key, "2026-02-01");
check("a month starting on a Saturday (Aug 2026)", buildMonthGrid(2026, 7)[0].key, "2026-07-26");
check("December spills into the next year", buildMonthGrid(2026, 11)[41].key.startsWith("2027-"), true);
check("February 2028 has 29 days", buildMonthGrid(2028, 1).filter((c) => c.inMonth).length, 29);

const range = gridRange(2026, 9);
check("range starts at the first cell", dayKey(range.start), "2026-09-27");
check("range ends the day after the last cell", dayKey(range.end), "2026-11-08");

// ---------- keys and labels
check("day key", dayKey(D(9, 5)), "2026-10-05");
check("key round trip", dayKey(dateFromKey("2026-10-13")), "2026-10-13");
check("month label", monthLabel(2026, 9), "October 2026");
check("side date", sideDate(D(9, 13)), "Tuesday, Oct 13");
check("side title for today", sideTitle(D(9, 13, 15), D(9, 13, 9)), "Today\u2019s Schedule");
check("side title for another day", sideTitle(D(9, 16), D(9, 13)), "Friday\u2019s Schedule");
check("aria with two", dayAria(D(9, 13), 2), "Tuesday, Oct 13, 2 assignments");
check("aria with one", dayAria(D(9, 13), 1), "Tuesday, Oct 13, 1 assignment");
check("aria with none", dayAria(D(9, 13), 0), "Tuesday, Oct 13, nothing due");
check("same day ignores the time", sameDay(D(9, 13, 1), D(9, 13, 23)), true);

// ---------- Previous and Next
check("next month keeps the day", dayKey(shiftMonth(2026, 9, 13, 1)), "2026-11-13");
check("previous month keeps the day", dayKey(shiftMonth(2026, 9, 13, -1)), "2026-09-13");
check("31st clamps to the end of a shorter month", dayKey(shiftMonth(2026, 0, 31, 1)), "2026-02-28");
check("31st clamps in a leap year", dayKey(shiftMonth(2028, 0, 31, 1)), "2028-02-29");
check("December next goes to January", dayKey(shiftMonth(2026, 11, 20, 1)), "2027-01-20");
check("January previous goes to December", dayKey(shiftMonth(2026, 0, 20, -1)), "2025-12-20");

// ---------- the keyboard
check("arrow right", dayKey(moveSelection(D(9, 13), "ArrowRight")), "2026-10-14");
check("arrow left", dayKey(moveSelection(D(9, 13), "ArrowLeft")), "2026-10-12");
check("arrow down is a week", dayKey(moveSelection(D(9, 13), "ArrowDown")), "2026-10-20");
check("arrow up is a week", dayKey(moveSelection(D(9, 13), "ArrowUp")), "2026-10-06");
check("arrow can cross into the next month", dayKey(moveSelection(D(9, 31), "ArrowRight")), "2026-11-01");
check("page down is next month", dayKey(moveSelection(D(9, 13), "PageDown")), "2026-11-13");
check("page up is previous month", dayKey(moveSelection(D(9, 13), "PageUp")), "2026-09-13");
check("other keys do nothing", [moveSelection(D(9, 13), "a"), moveSelection(D(9, 13), "Enter")], [null, null]);

// ---------- grouping
const now = D(9, 13, 10, 0);
const items = [
  { id: "a", title: "Lab Reflection", dueAt: D(9, 13, 17, 0).getTime(), status: "pending" },
  { id: "b", title: "Chapter 5 Essay", dueAt: D(9, 13, 23, 59).getTime(), status: "in_progress" },
  { id: "c", title: "Old quiz", dueAt: D(9, 9, 12, 0).getTime(), status: "pending" },
  { id: "d", title: "Done essay", dueAt: D(9, 9, 9, 0).getTime(), status: "submitted" },
  { id: "e", title: "No date" },
  { id: "f", title: "Alpha", dueAt: D(9, 13, 17, 0).getTime(), status: "pending" }
];
const byDay = groupByDay(items, now);
check("two days have assignments", Array.from(byDay.keys()).sort(), ["2026-10-09", "2026-10-13"]);
check("earliest first, ties by title", byDay.get("2026-10-13").map((i) => i.id), ["f", "a", "b"]);
check("a past pending one is Overdue", byDay.get("2026-10-09").find((i) => i.id === "c").status, "overdue");
check("a past submitted one stays Submitted", byDay.get("2026-10-09").find((i) => i.id === "d").status, "submitted");
check("an upcoming in progress one stays In Progress", byDay.get("2026-10-13").find((i) => i.id === "b").status, "in_progress");
check("no due date is skipped", Array.from(byDay.values()).flat().some((i) => i.id === "e"), false);
check("grouping works with Firestore style dates", Array.from(groupByDay([{ id: "x", title: "T", dueAt: { toDate: () => D(9, 20, 8, 0) }, status: "pending" }], now).keys()), ["2026-10-20"]);
check("nothing in, nothing out", groupByDay([], now).size, 0);

// ---------- chips
const three = [{ id: 1 }, { id: 2 }, { id: 3 }];
check("two chips and one more", [chipsFor(three).shown.length, chipsFor(three).more], [2, 1]);
check("one chip", [chipsFor([{ id: 1 }]).shown.length, chipsFor([{ id: 1 }]).more], [1, 0]);
check("no chips", chipsFor([]), { shown: [], more: 0 });
check("status classes match the stylesheet", STATUS_CLASS, { pending: "cal-pending", in_progress: "cal-progress", overdue: "cal-overdue", submitted: "cal-submitted" });

console.log(failed ? failed + " FAILED" : "ALL PASSED");
process.exit(failed ? 1 : 0);
