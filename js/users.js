/* ==========================================================
   TRACKLY users database
   One record per student in Firestore, at users/{their uid}.
   Fields: uid, fullName, email, photoURL, provider, createdAt

   The record is created at SIGN UP. Logging in never writes anything.
   The only exception is the quiet repair (ensureUserProfile below),
   which creates the record if, and only if, it is missing.
   ========================================================== */

import { db, doc, getDoc, setDoc, serverTimestamp } from "./firebase-config.js";

const flagKey = (uid) => "trackly_profile_ok_" + uid;

/* The browser remembers "this student's record exists" so we do not check again and again.
   localStorage can be blocked in some browsers, so every use is wrapped. */
function rememberSaved(uid) {
  try { localStorage.setItem(flagKey(uid), "1"); } catch (err) { /* ignore */ }
}
function alreadyChecked(uid) {
  try { return localStorage.getItem(flagKey(uid)) === "1"; } catch (err) { return false; }
}

/* Creates the student's record. */
export async function saveUserProfile(user) {
  await setDoc(doc(db, "users", user.uid), {
    uid: user.uid,
    fullName: user.displayName || "",
    email: user.email || "",
    photoURL: user.photoURL || "",
    provider: (user.providerData[0] && user.providerData[0].providerId) || "password",
    createdAt: serverTimestamp()
  });
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
    if (!snap.exists()) await saveUserProfile(user);
    rememberSaved(user.uid);
  } catch (err) {
    console.warn("Could not check the user record:", err);
  }
}