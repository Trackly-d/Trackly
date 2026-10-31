const { dueWithDay, sortDefault, filterAssignmentItems, toItems, buildCourseModel } = await import("../js/assignments.js");

let failed = 0;
const check = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) failed++; console.log(ok ? "PASS" : "FAIL", name, ok ? "" : "\n   got  " + JSON.stringify(got) + "\n   want " + JSON.stringify(want)); };

// Wednesday 7 Oct 2026, 10:00
const now = new Date(2026, 9, 7, 10, 0);
const d = (m, day, h = 23, min = 59) => new Date(2026, m, day, h, min);

check("due with weekday", dueWithDay(d(9, 7)), "Wed Oct 7");
check("due with weekday, another day", dueWithDay(d(9, 24)), "Sat Oct 24");
check("no date", dueWithDay(null), "No due date");

const courses = [
  { id: "bio", code: "BIO 101", title: "Introduction to Biology", color: "#00D996" },
  { id: "cs", code: "CS 106", shortName: "DSA", title: "Data Structures & Algorithms", color: "#F59E0B" },
  { id: "eco", title: "Microeconomics" }
];
const A = (id, courseId, title, dueAt, status, description, submittedAt) => ({ id, courseId, title, dueAt, status, description, submittedAt });
const raw = [
  A("1", "bio", "Chapter 5 Essay", d(9, 9), "in_progress", "Mendelian genetics"),
  A("2", "bio", "Cell Lab Report", d(9, 1), "pending", "Organelles"),                 // overdue
  A("3", "eco", "Problem Set", d(9, 12), "pending", "Macroeconomics"),
  A("4", "cs", "Binary Trees", d(9, 8), "pending", "Traversal and insertion"),
  A("5", "bio", "Old quiz", d(8, 20), "submitted", "Safety", d(8, 19, 14, 0)),
  A("6", "cs", "Arrays Lab", d(9, 3), "submitted", "Indexing", d(9, 2, 9, 30)),
  A("7", "eco", "Earlier overdue", d(8, 30), "in_progress", "Late one"),               // overdue, older
  A("8", "eco", "No due date", undefined, "pending", "Someday")
];
const items = toItems(courses, raw, now);

check("rows carry the course, status and submitted date",
  [items[4].course.code, items[4].status, items[4].submitted.getDate(), items[0].status, items[1].status],
  ["BIO 101", "submitted", 19, "in_progress", "overdue"]);

check("default order: overdue (oldest first), soonest due, no date last, submitted (newest first)",
  sortDefault(items).map((i) => i.id), ["7", "2", "4", "1", "3", "8", "6", "5"]);
check("sortDefault does not change the list it was given", items.map((i) => i.id), ["1", "2", "3", "4", "5", "6", "7", "8"]);

const bm = buildCourseModel("bio", raw, now).items.map((i) => i.id);
check("the course page and this page agree on the order for one course",
  sortDefault(items.filter((i) => i.course && i.course.id === "bio")).map((i) => i.id), bm);

// ----- chips
check("chip: pending", filterAssignmentItems(items, "pending", "").map((i) => i.id), ["4", "3", "8"]);
check("chip: in progress", filterAssignmentItems(items, "in_progress", "").map((i) => i.id), ["1"]);
check("chip: overdue", filterAssignmentItems(items, "overdue", "").map((i) => i.id), ["7", "2"]);
check("chip: submitted", filterAssignmentItems(items, "submitted", "").map((i) => i.id), ["6", "5"]);
check("chip: all, no search", filterAssignmentItems(items, "all", "").length, 8);

// ----- search across courses
check("search by title", filterAssignmentItems(items, "all", "binary").map((i) => i.id), ["4"]);
check("search by description", filterAssignmentItems(items, "all", "organelles").map((i) => i.id), ["2"]);
check("search by course code", filterAssignmentItems(items, "all", "bio 101").map((i) => i.id), ["2", "1", "5"]);
check("search by course code", filterAssignmentItems(items, "all", "cs 106").map((i) => i.id), ["4", "6"]);
// this sample course still has an old shortName saved: it is no longer searched
check("an old short name is no longer searched", filterAssignmentItems(items, "all", "dsa").map((i) => i.id), []);
check("search by course title", filterAssignmentItems(items, "all", "microeconomics").map((i) => i.id), ["7", "3", "8"]);
check("search by status word", filterAssignmentItems(items, "all", "overdue").map((i) => i.id), ["7", "2"]);
check("search by date text", filterAssignmentItems(items, "all", "oct 9").map((i) => i.id), ["1"]);
check("search together with a chip", filterAssignmentItems(items, "submitted", "cs 106").map((i) => i.id), ["6"]);
check("search is not case sensitive", filterAssignmentItems(items, "all", "BINARY").map((i) => i.id), ["4"]);
check("search with no match", filterAssignmentItems(items, "all", "zzzz"), []);
check("a row with no course does not crash", filterAssignmentItems(toItems([], [A("9", "gone", "Orphan", d(9, 9), "pending", "x")], now), "all", "orphan").length, 1);

console.log(failed ? failed + " FAILED" : "ALL PASSED");
