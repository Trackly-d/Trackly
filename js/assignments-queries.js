/* ==========================================================
   TRACKLY assignment queries
   Every question we ask Firestore about assignments lives here, built to read as little as possible.
   Firestore bills for each document it sends us, so:
     - numbers come from count() questions (about one read each, however many assignments exist)
     - lists ask for only the rows we show (limit), and "Show more" continues from where the last page ended
       (a cursor, never an offset, because an offset is billed for the rows it skips)

   Rules used everywhere (same as assignments.js):
     open      = status "pending" or "in_progress"
     overdue   = open, and the due date has passed
     upcoming  = open, and the due date is now or later
   Assumption: every assignment has a due date (dueAt), which Add Assignment will require.
   Assignments without one would not appear in the counts or lists below.

   This file is a factory, so it can be tested with a pretend Firestore.
   assignments-data.js plugs in the real one.
   ========================================================== */

import { plain } from "./plain.js";

export const OPEN = ["pending", "in_progress"];

/* Which groups each filter chip walks through, in order */
export const FILTER_GROUPS = {
  all: ["overdue", "upcoming", "submitted"],
  pending: ["pending"],
  in_progress: ["in_progress"],
  submitted: ["submitted"],
  overdue: ["overdue"]
};

export function createAssignmentsQueries(fs) {
  const { db, collection, query, where, orderBy, limit, startAfter, getDocs, getCountFromServer } = fs;

  const coll = (uid) => collection(db, "users", uid, "assignments");
  const forCourse = (courseId) => (courseId ? [where("courseId", "==", courseId)] : []);

  async function run(uid, constraints) {
    return (await getDocs(query(coll(uid), ...constraints))).docs;
  }

  async function count(uid, constraints) {
    return (await getCountFromServer(query(coll(uid), ...constraints))).data().count;
  }

  /* The question for one group of assignments, in the order we want them */
  function group(kind, now, courseId) {
    const base = forCourse(courseId);
    switch (kind) {
      case "overdue":
        return [...base, where("status", "in", OPEN), where("dueAt", "<", now), orderBy("dueAt", "asc")];
      case "upcoming":
        return [...base, where("status", "in", OPEN), where("dueAt", ">=", now), orderBy("dueAt", "asc")];
      case "pending":
        return [...base, where("status", "==", "pending"), where("dueAt", ">=", now), orderBy("dueAt", "asc")];
      case "in_progress":
        return [...base, where("status", "==", "in_progress"), where("dueAt", ">=", now), orderBy("dueAt", "asc")];
      case "submitted":
        return [...base, where("status", "==", "submitted"), orderBy("dueAt", "desc")];
      default:
        throw new Error("Unknown group: " + kind);
    }
  }

  /* ---------- Dashboard ---------- */

  /* The four cards and "due this week": 5 count questions, about 5 reads in total */
  async function dashboardCounts(uid, now, weekEnd) {
    const [pending, in_progress, submitted, overdue, week] = await Promise.all([
      count(uid, [where("status", "==", "pending"), where("dueAt", ">=", now)]),
      count(uid, [where("status", "==", "in_progress"), where("dueAt", ">=", now)]),
      count(uid, [where("status", "==", "submitted")]),
      count(uid, [where("status", "in", OPEN), where("dueAt", "<", now)]),
      count(uid, [where("status", "in", OPEN), where("dueAt", ">=", now), where("dueAt", "<", weekEnd)])
    ]);
    return { counts: { pending, in_progress, submitted, overdue }, week };
  }

  /* Total Assignments (overdue first, then the soonest) and Upcoming Deadlines. At most 12 documents. */
  async function dashboardLists(uid, now, totalRows = 6, upcomingRows = 3) {
    const [overdueDocs, upcomingDocs] = await Promise.all([
      run(uid, [...group("overdue", now), limit(totalRows)]),
      run(uid, [...group("upcoming", now), limit(totalRows)])
    ]);
    const overdue = overdueDocs.map(plain);
    const upcoming = upcomingDocs.map(plain);
    return {
      total: [...overdue, ...upcoming].slice(0, totalRows),
      upcoming: upcoming.slice(0, upcomingRows)
    };
  }

  /* ---------- One course ---------- */

  /* total and open assignments in a course (submitted is total minus open) */
  async function courseCounts(uid, courseId) {
    const [total, open] = await Promise.all([
      count(uid, forCourse(courseId)),
      count(uid, [...forCourse(courseId), where("status", "in", OPEN)])
    ]);
    return { total, open, submitted: total - open };
  }

  /* The earliest open due date in a course (overdue ones included), or null */
  async function courseNextDue(uid, courseId) {
    const docs = await run(uid, [...forCourse(courseId), where("status", "in", OPEN), orderBy("dueAt", "asc"), limit(1)]);
    return docs.length ? plain(docs[0]).dueAt : null;
  }

  /* ---------- Across all courses (the My Courses summary strip) ---------- */
  async function allStats(uid, now) {
    const [submitted, overdue, nextDocs] = await Promise.all([
      count(uid, [where("status", "==", "submitted")]),
      count(uid, [where("status", "in", OPEN), where("dueAt", "<", now)]),
      run(uid, [...group("upcoming", now), limit(1)])
    ]);
    return { submitted, overdue, nextUpcoming: nextDocs.length ? plain(nextDocs[0]).dueAt : null };
  }

  /* ---------- Pages with "Show more" ---------- */

  /* Walks through the groups of a filter, page by page.
     loadMore() returns { items, hasMore }. hasMore can be true on the very last page
     if the next group turns out to be empty, so a page that returns nothing means "done". */
  function createPager(uid, filter, now, courseId, pageSize = 20) {
    const kinds = FILTER_GROUPS[filter] || FILTER_GROUPS.all;
    let groupIndex = 0;
    let cursor = null;

    async function loadMore() {
      const items = [];
      let sameGroupHasMore = false;

      while (items.length < pageSize && groupIndex < kinds.length) {
        const need = pageSize - items.length;
        const constraints = [
          ...group(kinds[groupIndex], now, courseId),
          ...(cursor ? [startAfter(cursor)] : []),
          limit(need + 1) // one extra, only to know if this group has more
        ];
        const docs = await run(uid, constraints);
        const hasExtra = docs.length > need;
        const taken = hasExtra ? docs.slice(0, need) : docs;

        taken.forEach((d) => items.push(plain(d)));
        if (taken.length) cursor = taken[taken.length - 1];

        if (hasExtra) {
          sameGroupHasMore = true;
          break;
        }
        groupIndex += 1; // this group is finished, carry on with the next one
        cursor = null;
      }

      return { items, hasMore: sameGroupHasMore || groupIndex < kinds.length };
    }

    return { loadMore };
  }

  /* ---------- Search ---------- */

  /* Firestore cannot search text, so when the student searches we load up to max assignments
     once, and the page filters them on the device. */
  async function searchPool(uid, courseId, max = 200) {
    const docs = await run(uid, [...forCourse(courseId), limit(max)]);
    return docs.map(plain);
  }

  return { dashboardCounts, dashboardLists, courseCounts, courseNextDue, allStats, createPager, searchPool };
}