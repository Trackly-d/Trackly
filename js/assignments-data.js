/* ==========================================================
   TRACKLY assignments data
   The pages call these. They plug the real Firestore into assignments-queries.js
   and remember the small answers for a minute (see cache.js).

   Needs these Firestore tools exported by firebase-config.js. If the console says some are
   missing, replace the Firestore export line in firebase-config.js with:
     export * from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
   ========================================================== */

import * as fs from "./firebase-config.js";
import { createAssignmentsQueries } from "./assignments-queries.js";
import { cached } from "./cache.js";
import { plain } from "./plain.js";

const SHORT_MS = 60000;
const SEARCH_MS = 120000;

let queries = null;
function q() {
  if (!queries) {
    const needed = ["collection", "query", "where", "orderBy", "limit", "startAfter", "getDocs", "getCountFromServer"];
    const missing = needed.filter((name) => typeof fs[name] !== "function");
    if (missing.length) {
      throw new Error(
        "firebase-config.js is missing: " + missing.join(", ") + ". " +
        'Replace its Firestore export line with: export * from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";'
      );
    }
    queries = createAssignmentsQueries({
      db: fs.db,
      collection: fs.collection,
      query: fs.query,
      where: fs.where,
      orderBy: fs.orderBy,
      limit: fs.limit,
      startAfter: fs.startAfter,
      getDocs: fs.getDocs,
      getCountFromServer: fs.getCountFromServer
    });
  }
  return queries;
}

/* One assignment, or null if it does not exist (never remembered, so a new one shows at once).
   One document read, remembered for a minute. Only the student's own assignments can be found. */
export async function fetchAssignment(uid, id) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id || "")) return null;
  return cached(uid, "assignment:" + id, SHORT_MS, async () => {
    const snap = await fs.getDoc(fs.doc(fs.db, "users", uid, "assignments", id));
    return snap.exists() ? plain(snap) : null;
  });
}

/* Everything due from start up to (not including) end, earliest first, for the Calendar page.
   One query for the whole visible month, remembered for a minute. At most 200, with truncated saying if there were more. */
const RANGE_LIMIT = 200;
export function fetchAssignmentsInRange(uid, start, end) {
  return cached(uid, "range:" + start.getTime(), SHORT_MS, async () => {
    const snap = await fs.getDocs(fs.query(
      fs.collection(fs.db, "users", uid, "assignments"),
      fs.where("dueAt", ">=", start), fs.where("dueAt", "<", end),
      fs.orderBy("dueAt"), fs.limit(RANGE_LIMIT)
    ));
    const items = snap.docs.map((d) => plain(d));
    return { items, truncated: items.length >= RANGE_LIMIT };
  });
}

/* Assignments due from now on, earliest first (at most 200). Not remembered: used when the student presses
   "Add reminders to existing assignments", so it must be fresh. */
const UPCOMING_LIMIT = 200;
export async function fetchUpcomingAssignments(uid, now = new Date()) {
  const snap = await fs.getDocs(fs.query(
    fs.collection(fs.db, "users", uid, "assignments"),
    fs.where("dueAt", ">", now), fs.orderBy("dueAt"), fs.limit(UPCOMING_LIMIT)
  ));
  return snap.docs.map((d) => plain(d));
}

/* The four numbers and "due this week" on the dashboard */
export function dashboardCounts(uid, now, weekEnd) {
  return cached(uid, "dash-counts", SHORT_MS, () => q().dashboardCounts(uid, now, weekEnd));
}

/* The first rows of Total Assignments and Upcoming Deadlines */
export function dashboardLists(uid, now) {
  return cached(uid, "dash-lists", SHORT_MS, () => q().dashboardLists(uid, now));
}

/* { total, open, submitted } for one course */
export function courseCounts(uid, courseId) {
  return cached(uid, "course-counts:" + courseId, SHORT_MS, () => q().courseCounts(uid, courseId));
}

/* { next } for one course: its earliest open due date in milliseconds, or null */
export function courseNextDue(uid, courseId) {
  return cached(uid, "course-next:" + courseId, SHORT_MS, async () => ({ next: await q().courseNextDue(uid, courseId) }));
}

/* { submitted, overdue, nextUpcoming } across every course */
export function allStats(uid, now) {
  return cached(uid, "all-stats", SHORT_MS, () => q().allStats(uid, now));
}

/* A list that continues with "Show more". Not remembered, because it keeps its place as it goes. */
export function createPager(uid, filter, now, courseId, pageSize = 20) {
  return q().createPager(uid, filter, now, courseId, pageSize);
}

/* Up to 200 assignments, loaded once the first time the student searches */
export function searchPool(uid, courseId = null, max = 200) {
  return cached(uid, "search:" + (courseId || "all"), SEARCH_MS, () => q().searchPool(uid, courseId, max));
}