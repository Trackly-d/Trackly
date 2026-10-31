import { validateAssignment, buildAssignmentData, buildAssignmentUpdate, buildDueDate, todayString, isFormDirty, normalize } from "../js/assignment-form.js";

let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(ok ? "PASS" : "FAIL", name, ok ? "" : "got " + JSON.stringify(got) + " want " + JSON.stringify(want));
};

// Monday 12 Oct 2026, 10:00 (local time)
const now = new Date(2026, 9, 12, 10, 0);
const good = { title: "Chapter 5 Essay", courseId: "c1", date: "2026-10-24", time: "23:59", notes: "Focus on the cell membrane.", priority: "high" };
const courses = ["c1", "c2"];

check("today string", todayString(now), "2026-10-12");
check("due date built in local time", buildDueDate("2026-10-24", "23:59").getTime(), new Date(2026, 9, 24, 23, 59).getTime());
check("missing time gives null", buildDueDate("2026-10-24", ""), null);
check("impossible date gives null", buildDueDate("2026-02-31", "10:00"), null);

const ok = validateAssignment(good, now, courses);
check("good form passes", ok.ok, true);
check("due returned", ok.due.getTime(), new Date(2026, 9, 24, 23, 59).getTime());

check("title too short", validateAssignment({ ...good, title: " a " }, now, courses).errors.title, "Enter the assignment title.");
check("title too long", Boolean(validateAssignment({ ...good, title: "x".repeat(121) }, now, courses).errors.title), true);
check("title 120 is fine", validateAssignment({ ...good, title: "x".repeat(120) }, now, courses).ok, true);
check("course required", validateAssignment({ ...good, courseId: "" }, now, courses).errors.course, "Choose a course.");
check("course must be the student's own", validateAssignment({ ...good, courseId: "zzz" }, now, courses).errors.course, "Choose a course.");
check("date required", validateAssignment({ ...good, date: "" }, now, courses).errors.date, "Choose the due date.");
check("time required, no default", validateAssignment({ ...good, time: "" }, now, courses).errors.time, "Choose the due time.");
check("past day refused", validateAssignment({ ...good, date: "2026-10-11" }, now, courses).errors.date, "The due date cannot be in the past.");
check("earlier today refused", validateAssignment({ ...good, date: "2026-10-12", time: "09:00" }, now, courses).errors.time, "That time has already passed today. Choose a later time.");
check("exactly now refused", Boolean(validateAssignment({ ...good, date: "2026-10-12", time: "10:00" }, now, courses).errors.time), true);
check("later today fine", validateAssignment({ ...good, date: "2026-10-12", time: "10:01" }, now, courses).ok, true);
check("notes required", validateAssignment({ ...good, notes: "   " }, now, courses).errors.notes, "Add the assignment question or a few notes.");
check("notes too long", Boolean(validateAssignment({ ...good, notes: "x".repeat(2001) }, now, courses).errors.notes), true);
check("custom with nothing chosen", validateAssignment({ ...good, reminderMode: "custom", remindMinutes: [] }, now, courses).errors.reminder, "Choose at least one reminder, or pick None.");
check("custom with six refused", Boolean(validateAssignment({ ...good, reminderMode: "custom", remindMinutes: [0, 30, 60, 120, 1440, 2880] }, now, courses).errors.reminder), true);
check("custom with two fine", validateAssignment({ ...good, reminderMode: "custom", remindMinutes: [30, 60] }, now, courses).ok, true);
check("none needs no minutes", validateAssignment({ ...good, reminderMode: "none" }, now, courses).ok, true);
check("all empty gives every error", Object.keys(validateAssignment({}, now, courses).errors).sort(), ["course", "date", "notes", "time", "title"]);

const data = buildAssignmentData({ ...good, title: "  Chapter 5 Essay  " }, ok.due);
check("saved as pending", data.status, "pending");
check("notes saved as description", data.description, "Focus on the cell membrane.");
check("title trimmed", data.title, "Chapter 5 Essay");
check("priority kept", data.priority, "high");
check("default reminder mode", data.reminder, { mode: "default" });
check("calendar starts null", data.calendar, null);
check("empty optional fields not saved", ["unit", "topic", "submissionFormat", "submissionInfo"].filter((k) => k in data), []);
const full = buildAssignmentData({ ...good, unit: "Unit 2", topic: "Cell Biology", submissionFormat: "PDF", submissionInfo: "Portal", reminderMode: "custom", remindMinutes: [30, 1440, 30] }, ok.due);
check("filled optional fields saved", [full.unit, full.topic, full.submissionFormat, full.submissionInfo], ["Unit 2", "Cell Biology", "PDF", "Portal"]);
check("custom minutes unique, biggest first", full.reminder, { mode: "custom", minutes: [1440, 30] });
check("unknown priority becomes medium", normalize({ priority: "urgent" }).priority, "medium");
check("unknown minutes dropped", normalize({ remindMinutes: [45, 30] }).remindMinutes, [30]);

const start = { ...good };
check("untouched is not dirty", isFormDirty(start, start), false);
check("spaces only is not dirty", isFormDirty({ ...start, unit: "   " }, start), false);
check("typing is dirty", isFormDirty({ ...start, title: "New" }, start), true);
check("priority change is dirty", isFormDirty({ ...start, priority: "low" }, start), true);
check("reminder change is dirty", isFormDirty({ ...start, reminderMode: "none" }, start), true);

// Editing
const original = new Date(2026, 9, 12, 10, 30);
const laterNow = new Date(2026, 9, 12, 11, 0); // the due moment passed while the form was open
const editValues = { ...good, date: "2026-10-12", time: "10:30" };
check("unchanged due moment is not refused when editing", validateAssignment(editValues, laterNow, courses, original).ok, true);
check("same moment is refused when adding", Boolean(validateAssignment(editValues, laterNow, courses).errors.time), true);
check("a new past moment is refused when editing", Boolean(validateAssignment({ ...editValues, time: "10:45" }, laterNow, courses, original).errors.time), true);
const upd = buildAssignmentUpdate({ ...good, unit: "Unit 3", topic: "  " }, ok.due);
check("update keeps status and createdAt out", ["status", "createdAt", "startedAt", "submittedAt", "calendar"].filter((k) => k in upd.set), []);
check("update sets the edited fields", [upd.set.title, upd.set.unit, upd.set.priority], ["Chapter 5 Essay", "Unit 3", "high"]);
check("emptied optional fields are removed", upd.remove, ["topic", "submissionFormat", "submissionInfo"]);

console.log(failed ? failed + " FAILED" : "ALL PASSED");
process.exit(failed ? 1 : 0);
