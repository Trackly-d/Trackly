/* ==========================================================
   TRACKLY courses data
   Reads a student's courses and assignments from Firestore.

   Where the data lives (each student only sees their own, see firestore.rules):
     users/{uid}/courses/{courseId}
        title (required), code, shortName, instructor, color (like "#00D996"),
        imageUrl, location (like "Hall C, Rm 204"), credits (like "4.0 Credits"), createdAt
     users/{uid}/assignments/{assignmentId}
        courseId, title, description (required), dueAt (a date),
        status ("pending", "in_progress" or "submitted"), startedAt, submittedAt
        Overdue is never stored. It is worked out from the date (see assignments.js).
   The Add Course and Assignments pages will write to these.
   ========================================================== */

import { db, collection, getDocs, doc, getDoc } from "./firebase-config.js";

async function readAll(uid, name) {
  const snap = await getDocs(collection(db, "users", uid, name));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/* One course, or null if it does not exist. Only the student's own courses can be found. */
export async function fetchCourse(uid, courseId) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(courseId || "")) return null;
  const snap = await getDoc(doc(db, "users", uid, "courses", courseId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export function fetchCourses(uid) {
  return readAll(uid, "courses");
}

export function fetchAssignments(uid) {
  return readAll(uid, "assignments");
}