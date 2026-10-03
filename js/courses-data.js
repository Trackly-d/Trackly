/* ==========================================================
   TRACKLY courses data
   Reads a student's courses and assignments from Firestore.

   Where the data lives (each student only sees their own, see firestore.rules):
     users/{uid}/courses/{courseId}
        title (required), code, instructor, color (like "#00D996"),
        imageUrl, location (like "Hall C, Rm 204"), credits (like "4.0 Credits"), createdAt
     users/{uid}/assignments/{assignmentId}
        courseId, title, dueAt (a date),
        status ("pending", "in_progress" or "submitted"), startedAt, submittedAt
        Overdue is never stored. It is worked out from the date (see assignments.js).
   The Add Course and Assignments pages will write to these.
   ========================================================== */

import { db, collection, getDocs } from "./firebase-config.js";

async function readAll(uid, name) {
  const snap = await getDocs(collection(db, "users", uid, name));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export function fetchCourses(uid) {
  return readAll(uid, "courses");
}

export function fetchAssignments(uid) {
  return readAll(uid, "assignments");
}