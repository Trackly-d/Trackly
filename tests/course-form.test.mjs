const { buildCourseUpdate, CLEARED_PHOTO } = await import("../js/course-form.js");
let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(ok ? "PASS" : "FAIL", name, ok ? "" : "got " + JSON.stringify(got) + " want " + JSON.stringify(want));
};
const v = { title: "  Biology  ", code: " BIO 101 ", instructor: "Dr. Smith ", color: "#00D996" };

check("trims and keeps photo fields out when kept",
  buildCourseUpdate(v, { kind: "keep" }),
  { title: "Biology", code: "BIO 101", instructor: "Dr. Smith", color: "#00D996" });
check("cleared boxes are saved empty",
  buildCourseUpdate({ title: "Bio", code: "", instructor: "", color: "#EF4444" }, { kind: "keep" }),
  { title: "Bio", code: "", instructor: "", color: "#EF4444" });
check("replace with the student's own photo wipes an old credit",
  buildCourseUpdate(v, { kind: "replace", fields: { imageUrl: "https://x/y.jpg", imagePublicId: "y", imageSource: "upload" } }).imageCredit, null);
check("replace with a Pixabay photo keeps its credit",
  buildCourseUpdate(v, { kind: "replace", fields: { imageUrl: "https://x/y.jpg", imagePublicId: "y", imageSource: "pixabay", imageCredit: { name: "Ann", url: "u", source: "Pixabay" } } }).imageCredit,
  { name: "Ann", url: "u", source: "Pixabay" });
const cleared = buildCourseUpdate(v, { kind: "clear" });
check("clear removes every photo field", [cleared.imageUrl, cleared.imagePublicId, cleared.imageSource, cleared.imageCredit], ["", "", "", null]);
check("missing values do not crash", buildCourseUpdate({ title: undefined, color: "#00D996" }, { kind: "keep" }).title, "");
console.log(failed ? failed + " FAILED" : "ALL PASSED");

// an old course may still have a shortName saved: a save must neither write it nor erase it
check("a save never touches a saved shortName", "shortName" in buildCourseUpdate({ title: "Bio", code: "BIO", shortName: "OLD", instructor: "", color: "#EF4444" }, { kind: "keep" }), false);
