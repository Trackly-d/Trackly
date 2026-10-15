/* ==========================================================
   TRACKLY calendar saving helpers (Firestore)
   Small functions the pages hand to js/calendar-sync.js.

   users/{uid}/assignments/{id}.calendar   { events: [{ kind, id }], timeZone, syncedAt } or null
   users/{uid}/calendarCleanup/{assignmentId}   { eventIds, createdAt }  (removals to finish on a later visit)

   Only event ids and the time zone are stored. Never a Google token.
   ========================================================== */

import { db, collection, doc, getDocs, setDoc, deleteDoc, updateDoc, query, limit, serverTimestamp } from "./firebase-config.js";
import { calendarField } from "./calendar-sync.js";

const CLEANUP_LIMIT = 50;

export function saveCalendarField(ref, events, timeZone) {
  return updateDoc(ref, { calendar: { ...calendarField(events, timeZone), syncedAt: serverTimestamp() } });
}

export function clearCalendarField(ref) {
  return updateDoc(ref, { calendar: null });
}

export function queueCleanup(uid, assignmentId, eventIds) {
  return setDoc(doc(db, "users", uid, "calendarCleanup", assignmentId), { eventIds, createdAt: serverTimestamp() });
}

export async function listCleanup(uid) {
  const snap = await getDocs(query(collection(db, "users", uid, "calendarCleanup"), limit(CLEANUP_LIMIT)));
  return snap.docs.map((d) => ({ id: d.id, eventIds: Array.isArray(d.data().eventIds) ? d.data().eventIds : [] }));
}

export function finishCleanup(uid, assignmentId) {
  return deleteDoc(doc(db, "users", uid, "calendarCleanup", assignmentId));
}

/* After Disconnect the Worker has removed every Trackly event, so nothing is left to finish */
export async function clearAllCleanup(uid) {
  for (const item of await listCleanup(uid)) await finishCleanup(uid, item.id);
}