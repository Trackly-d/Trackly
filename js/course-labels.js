/* ==========================================================
   TRACKLY course chip labels
   The small label that shows a course on a row (like "BIO 101" or "DSA").
   One rule, used on every page, so a course always looks the same:
     1. the Short Name the student typed, if there is one
     2. otherwise the course code
     3. otherwise the title, without words like "Introduction to", cut short with "..."
   ========================================================== */

const LEADING_FILLER = /^(introduction to|intro to|fundamentals of|foundations of|principles of|basics of|basic|advanced|elementary|general|applied)\s+/i;

export function courseChipLabel(course, maxLength = 14) {
  if (!course) return "No course";

  const shortName = (course.shortName || "").trim();
  if (shortName) return shortName;

  const code = (course.code || "").trim();
  if (code) return code;

  let title = (course.title || "").trim().replace(LEADING_FILLER, "");
  if (title.length > maxLength) title = title.slice(0, maxLength - 1).trimEnd() + "\u2026";
  return title || "Course";
}