/* ==========================================================
   TRACKLY courses data
   Reads a student's courses from Firestore, and remembers the answer for a short
   while (see cache.js), so moving between pages does not read them again.

   Where the data lives (each student only sees their own, see firestore.rules):
     users/{uid}/courses/{courseId}
        title (required), code, instructor, color (like "#00D996"),
        imageUrl, location (like "Hall C, Rm 204"), credits (like "4.0 Credits"), createdAt
     users/{uid}/assignments/{assignmentId}
        courseId, title, description (required), dueAt (a date, required),
        status ("pending", "in_progress" or "submitted"), startedAt, submittedAt
        Overdue is never stored. It is worked out from the date (see assignments.js).

   Assignments are NOT read here. They are read by assignments-data.js, in small
   pieces, because loading every assignment on every page is what makes Firestore bills grow.
   ========================================================== */

import { db, collection, getDocs, doc, getDoc } from "./firebase-config.js";
import { plain } from "./plain.js";
import { cached } from "./cache.js";

const COURSES_TTL_MS = 120000;

export function fetchCourses(uid) {
  return cached(uid, "courses", COURSES_TTL_MS, async () => {
    const snap = await getDocs(collection(db, "users", uid, "courses"));
    return snap.docs.map(plain);
  });
}

/* One course, or null if it does not exist. Only the student's own courses can be found. */
export async function fetchCourse(uid, courseId) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(courseId || "")) return null;
  return cached(uid, "course:" + courseId, COURSES_TTL_MS, async () => {
    const snap = await getDoc(doc(db, "users", uid, "courses", courseId));
    return snap.exists() ? plain(snap) : null; // "not found" is never remembered
  });
}
