/* ==========================================================
   TRACKLY users database
   One record per student in Firestore, at users/{their uid}.
   Fields: uid, fullName, email, photoURL, provider, createdAt,
           termsAcceptedAt, termsVersion

   The record is created at SIGN UP. Logging in never writes anything.
   The only exception is the quiet repair (ensureUserProfile below),
   which creates the record if, and only if, it is missing.
   ========================================================== */

import { db, doc, getDoc, setDoc, serverTimestamp } from "./firebase-config.js";

/* The date of the Terms of Service and Privacy Policy students agree to.
   Change this whenever you change those pages (use the "Last updated" date). */
export const TERMS_VERSION = "2026-10-02";

const flagKey = (uid) => "trackly_profile_ok_" + uid;

/* The browser remembers "this student's record exists" so we do not check again and again.
   localStorage can be blocked in some browsers, so every use is wrapped. */
function rememberSaved(uid) {
  try { localStorage.setItem(flagKey(uid), "1"); } catch (err) { /* ignore */ }
}
function alreadyChecked(uid) {
  try { return localStorage.getItem(flagKey(uid)) === "1"; } catch (err) { return false; }
}

/* Creates the student's record.
   At sign up it also saves when they agreed to the terms.
   In repair mode we cannot know that date, so we do not invent one. */
export async function saveUserProfile(user, { repair = false } = {}) {
  const data = {
    uid: user.uid,
    fullName: user.displayName || "",
    email: user.email || "",
    photoURL: user.photoURL || "",
    provider: (user.providerData[0] && user.providerData[0].providerId) || "password",
    createdAt: repair && user.metadata && user.metadata.creationTime
      ? new Date(user.metadata.creationTime)
      : serverTimestamp()
  };

  if (repair) {
    data.repairedAt = serverTimestamp();
  } else {
    data.termsAcceptedAt = serverTimestamp();
    data.termsVersion = TERMS_VERSION;
  }

  await setDoc(doc(db, "users", user.uid), data);
  rememberSaved(user.uid);
}

/* Same thing, but it never blocks or breaks the sign up.
   If the database is slow or offline, we wait at most 6 seconds, then carry on.
   If it fails, the quiet repair below fixes it on the student's next page visit. */
export async function saveUserProfileSafe(user) {
  try {
    await Promise.race([
      saveUserProfile(user),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Database save timed out")), 6000))
    ]);
  } catch (err) {
    console.warn("Could not save the user record at sign up:", err);
  }
}

/* QUIET REPAIR: creates the record only if it is missing.
   After the first successful check, the browser skips it, so it costs nothing later. */
export async function ensureUserProfile(user) {
  if (alreadyChecked(user.uid)) return;
  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    if (!snap.exists()) await saveUserProfile(user, { repair: true });
    rememberSaved(user.uid);
  } catch (err) {
    console.warn("Could not check the user record:", err);
  }
}

/* ---------- The welcome screen ----------
   A brand new student sees the welcome screen once. Clicking "Skip for Now"
   saves welcomeSkipped on their record, so it never comes back, on any device. */

export async function fetchUserRecord(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? snap.data() : null;
}

async function markWelcomeSkipped(user) {
  await ensureUserProfile(user); // makes sure the record exists first
  await setDoc(
    doc(db, "users", user.uid),
    { welcomeSkipped: true, welcomeSkippedAt: serverTimestamp() },
    { merge: true }
  );
}

/* Never blocks the student: waits at most 6 seconds, then lets them through */
export async function markWelcomeSkippedSafe(user) {
  try {
    await Promise.race([
      markWelcomeSkipped(user),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Database save timed out")), 6000))
    ]);
  } catch (err) {
    console.warn("Could not save that the welcome screen was skipped:", err);
  }
}