/* ==========================================================
   TRACKLY notifications data (Firestore)

   Reads, for the bell on every page and for the Notifications page, remembered together for a minute:
     - the student's own record (alert settings, and what has been read)
     - assignments due in the next 48 hours (up to 50)
     - open assignments that passed their due time in the last 30 days (up to 50)
     - saved activity: "added" and "submitted" from the last 30 days (up to 50)
   That is a few reads per page, and nothing at all while the answer is remembered.

   Saved:
     users/{uid}                        alertsEnabled, alertHours, notificationsRead { allBefore, keys }
     users/{uid}/notifications/{id}     { type, assignmentId, title, courseTitle, createdAt }
   ========================================================== */

import * as fs from "./firebase-config.js";
import { cached } from "./cache.js";
import { plain } from "./plain.js";
import { alertSettingsFrom, ALERT_HOURS, WINDOW_DAYS, EMPTY_READ } from "./notifications-logic.js";

const CACHE_MS = 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;
const SOON_MS = Math.max(...ALERT_HOURS) * 60 * 60 * 1000;

export function fetchNotificationInputs(uid, now = new Date()) {
  return cached(uid, "notifications:inputs", CACHE_MS, async () => {
    const t = now.getTime();
    const windowStart = new Date(t - WINDOW_DAYS * DAY);
    const assignments = fs.collection(fs.db, "users", uid, "assignments");
    const [userSnap, soon, overdue, activity] = await Promise.all([
      fs.getDoc(fs.doc(fs.db, "users", uid)),
      fs.getDocs(fs.query(assignments, fs.where("dueAt", ">", now), fs.where("dueAt", "<=", new Date(t + SOON_MS)), fs.orderBy("dueAt"), fs.limit(50))),
      fs.getDocs(fs.query(assignments, fs.where("dueAt", "<=", now), fs.where("dueAt", ">", windowStart), fs.orderBy("dueAt", "desc"), fs.limit(50))),
      fs.getDocs(fs.query(fs.collection(fs.db, "users", uid, "notifications"), fs.where("createdAt", ">", windowStart), fs.orderBy("createdAt", "desc"), fs.limit(50)))
    ]);
    const user = userSnap.exists() ? plain(userSnap) : {};
    const saved = user.notificationsRead;
    const read = saved && typeof saved === "object" ? { allBefore: Number(saved.allBefore) || 0, keys: saved.keys || {} } : EMPTY_READ;
    return {
      settings: { ...alertSettingsFrom(user), read },
      assignments: [...soon.docs, ...overdue.docs].map(plain),
      activity: activity.docs.map(plain)
    };
  });
}

/* Just the alert settings (for the Settings page) */
export async function fetchAlertSettings(uid) {
  const snap = await fs.getDoc(fs.doc(fs.db, "users", uid));
  return alertSettingsFrom(snap.exists() ? plain(snap) : {});
}

/* updateDoc replaces a whole field (so removed read marks really go). If the record does not exist yet, create it. */
async function updateUser(uid, fields) {
  const ref = fs.doc(fs.db, "users", uid);
  try {
    await fs.updateDoc(ref, fields);
  } catch (err) {
    await fs.setDoc(ref, fields, { merge: true });
  }
}

export function saveAlertSettings(uid, { alertsEnabled, alertHours }) {
  return updateUser(uid, { alertsEnabled, alertHours });
}

export function saveReadState(uid, read) {
  return updateUser(uid, { notificationsRead: read });
}

/* Saved the moment it happens. entry comes from activityEntry() in notifications-logic.js */
export function writeActivity(uid, entry) {
  return fs.setDoc(fs.doc(fs.db, "users", uid, "notifications", entry.id), { ...entry.data, createdAt: fs.serverTimestamp() });
}

/* When an assignment is deleted, its history goes with it */
export async function removeActivityFor(uid, assignmentId) {
  const snap = await fs.getDocs(fs.query(fs.collection(fs.db, "users", uid, "notifications"), fs.where("assignmentId", "==", assignmentId), fs.limit(50)));
  await Promise.all(snap.docs.map((d) => fs.deleteDoc(d.ref)));
}

/* Tidy up: history older than 30 days is not shown, so it is removed (a few at a time) */
export async function pruneActivity(uid, beforeMs) {
  const snap = await fs.getDocs(fs.query(fs.collection(fs.db, "users", uid, "notifications"), fs.where("createdAt", "<", new Date(beforeMs)), fs.limit(20)));
  await Promise.all(snap.docs.map((d) => fs.deleteDoc(d.ref)));
}