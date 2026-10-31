globalThis.window = {};
const { buildCourseModel, filterCourseItems, shortDate } = await import("../js/assignments.js");
const { courseChipLabel } = await import("../js/course-labels.js");
const { headerImage } = await import("../js/images.js");

let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(ok ? "PASS" : "FAIL", name, ok ? "" : "got " + JSON.stringify(got) + " want " + JSON.stringify(want));
};

// ----- chip label
check("the code is the label", courseChipLabel({ code: "CS 106", title: "Data Structures & Algorithms" }), "CS 106");
check("an old saved short name is ignored, the code wins", courseChipLabel({ shortName: "DSA", code: "CS 106", title: "Data Structures & Algorithms" }), "CS 106");
check("an old short name with no code is ignored, the title is used", courseChipLabel({ shortName: "DSA", title: "Physics" }), "Physics");
check("then the code", courseChipLabel({ code: "CS 106", title: "Data Structures & Algorithms" }), "CS 106");
check("then a cleaned title", courseChipLabel({ title: "Introduction to Biology" }), "Biology");
check("long title cut with dots", courseChipLabel({ title: "Data Structures & Algorithms" }), "Data Structure\u2026".slice(0, 13) + "\u2026");
check("advanced stripped", courseChipLabel({ title: "Advanced Calculus" }), "Calculus");
check("blank spaces ignored", courseChipLabel({ shortName: "  ", code: "  ", title: "Physics" }), "Physics");
check("no course", courseChipLabel(null), "No course");
check("empty course", courseChipLabel({}), "Course");

// ----- headerImage keeps working, now with a height
const stored = "https://res.cloudinary.com/demo/image/upload/v1700000000/trackly/abc.jpg";
check("card size", headerImage(stored), "https://res.cloudinary.com/demo/image/upload/f_auto,q_auto,c_fill,g_auto,w_640,h_240/v1700000000/trackly/abc.jpg");
check("banner size", headerImage(stored, 1200, 200), "https://res.cloudinary.com/demo/image/upload/f_auto,q_auto,c_fill,g_auto,w_1200,h_200/v1700000000/trackly/abc.jpg");

// ----- course model. Wednesday 7 Oct 2026, 10:00
const now = new Date(2026, 9, 7, 10, 0);
const d = (m, day, h = 23, min = 59) => new Date(2026, m, day, h, min);
const A = (id, courseId, title, dueAt, status, description = "d") => ({ id, courseId, title, dueAt, status, description });
const all = [
  A("a1", "bio", "Essay", d(9, 9), "in_progress"),
  A("a2", "bio", "Lab report", d(9, 1), "pending"),            // overdue
  A("a3", "bio", "Study guide", d(10, 5), "pending"),
  A("a4", "bio", "Old quiz", d(8, 20), "submitted"),
  A("a5", "bio", "Newer quiz", d(9, 2), "submitted"),
  A("a6", "bio", "Overdue earlier", d(8, 30), "pending"),      // overdue, older
  A("x1", "eco", "Other course", d(9, 8), "pending"),          // must NOT count
  A("x2", "eco", "Other course 2", d(9, 9), "submitted")       // must NOT count
];
const m = buildCourseModel("bio", all, now);
check("only this course", m.total, 6);
check("order: overdue (oldest first), open (soonest), submitted (newest first)",
  m.items.map((i) => i.id), ["a6", "a2", "a1", "a3", "a5", "a4"]);
check("counts", m.counts, { pending: 1, in_progress: 1, submitted: 2, overdue: 2 });
check("open tasks = everything not submitted", m.openCount, 4);
check("pace uses only this course", m.pace, { done: 2, total: 6, percent: 33 });

const none = buildCourseModel("bio", [], now);
check("empty course pace", [none.total, none.openCount, none.pace.percent], [0, 0, 0]);

const noDate = buildCourseModel("c", [A("n1", "c", "No date", undefined, "pending"), A("n2", "c", "Dated", d(9, 9), "pending")], now);
check("no date goes last", noDate.items.map((i) => i.id), ["n2", "n1"]);

// ----- filters and search
check("filter overdue", filterCourseItems(m.items, "overdue", "").map((i) => i.id), ["a6", "a2"]);
check("filter in progress", filterCourseItems(m.items, "in_progress", "").map((i) => i.id), ["a1"]);
check("filter submitted", filterCourseItems(m.items, "submitted", "").map((i) => i.id), ["a5", "a4"]);
check("search title", filterCourseItems(m.items, "all", "quiz").map((i) => i.id), ["a5", "a4"]);
check("search + filter together", filterCourseItems(m.items, "submitted", "newer").map((i) => i.id), ["a5"]);
check("search by status word", filterCourseItems(m.items, "all", "overdue").map((i) => i.id), ["a6", "a2"]);
check("search by date text", filterCourseItems(m.items, "all", "oct 9").map((i) => i.id), ["a1"]);
check("search with no match", filterCourseItems(m.items, "all", "zzz"), []);
check("shortDate", [shortDate(d(9, 24)), shortDate(null)], ["Oct 24", "No due date"]);

console.log(failed ? failed + " FAILED" : "ALL PASSED");
