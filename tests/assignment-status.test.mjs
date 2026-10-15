import { statusChange, editRule, dueDateText, dueTimeText, createdText, modifiedText, unitTopicText, dueToInputs } from "../js/assignment-status.js";

let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(ok ? "PASS" : "FAIL", name, ok ? "" : "got " + JSON.stringify(got) + " want " + JSON.stringify(want));
};

// Monday 12 Oct 2026, 16:30 (local time)
const now = new Date(2026, 9, 12, 16, 30);
const future = new Date(2026, 9, 24, 23, 59);

check("same status changes nothing", statusChange({ status: "pending" }, "pending"), null);
check("overdue cannot be set", statusChange({ status: "pending" }, "overdue"), null);
check("first in progress saves startedAt", statusChange({ status: "pending" }, "in_progress"), { status: "in_progress", startedAt: "now" });
check("in progress again keeps startedAt", statusChange({ status: "pending", startedAt: 1 }, "in_progress"), { status: "in_progress" });
check("submitted saves submittedAt", statusChange({ status: "in_progress", startedAt: 1 }, "submitted"), { status: "submitted", submittedAt: "now" });
check("moving back clears submittedAt", statusChange({ status: "submitted", submittedAt: 1 }, "pending"), { status: "pending", submittedAt: "clear" });
check("back to in progress without startedAt sets it and clears submittedAt", statusChange({ status: "submitted" }, "in_progress"), { status: "in_progress", startedAt: "now", submittedAt: "clear" });

check("pending future can be edited", editRule({ status: "pending", dueAt: future }, now).ok, true);
check("in progress future can be edited", editRule({ status: "in_progress", dueAt: future }, now).ok, true);
check("overdue cannot be edited", editRule({ status: "pending", dueAt: new Date(2026, 9, 1) }, now), { ok: false, reason: "Overdue assignments cannot be edited." });
check("submitted cannot be edited", editRule({ status: "submitted", dueAt: future }, now), { ok: false, reason: "Submitted assignments cannot be edited." });
check("submitted late cannot be edited (says submitted)", editRule({ status: "submitted", dueAt: new Date(2026, 9, 1) }, now).reason, "Submitted assignments cannot be edited.");

check("due date text", dueDateText(future, now), "Saturday, Oct 24");
check("due date text next year has the year", dueDateText(new Date(2027, 0, 5, 9, 0), now), "Tuesday, Jan 5, 2027");
check("no due date", dueDateText(null, now), "No due date");
check("due time starts with the clock", dueTimeText(future).startsWith("11:59 PM"), true);
check("created text", createdText(new Date(2026, 9, 12, 8, 0)), "Oct 12, 2026");
check("modified today", modifiedText(new Date(2026, 9, 12, 16, 12), now), "Last modified today at 4:12 PM");
check("modified yesterday", modifiedText(new Date(2026, 9, 11, 9, 5), now), "Last modified yesterday at 9:05 AM");
check("modified earlier", modifiedText(new Date(2026, 9, 1, 9, 5), now), "Last modified on Oct 1, 2026 at 9:05 AM");
check("modified missing", modifiedText(null, now), "");
check("unit and topic", unitTopicText({ unit: "Unit 2", topic: "Cell Biology" }), "Unit 2 \u2022 Cell Biology");
check("unit only", unitTopicText({ unit: "Unit 2" }), "Unit 2");
check("neither", unitTopicText({}), "");
check("due to form boxes", dueToInputs(new Date(2026, 9, 4, 9, 5)), { date: "2026-10-04", time: "09:05" });

console.log(failed ? failed + " FAILED" : "ALL PASSED");
process.exit(failed ? 1 : 0);
