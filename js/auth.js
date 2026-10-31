/* ==========================================================
   TRACKLY auth service
   All Firebase login logic lives here. The page files (login-page.js,
   signup-page.js) only call these functions and show the result.
   ========================================================== */

import {
  auth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
  signOut,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  getAdditionalUserInfo,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  sendPasswordResetEmail,
  verifyPasswordResetCode,
  confirmPasswordReset
} from "./firebase-config.js";
import { saveUserProfileSafe, saveUserProfileStrict, ensureUserProfile, fetchUserRecord } from "./users.js";
import { consentErrorMessage } from "./consent-client.js";

// Where students go after signing in, and where signed out students are sent.
export const DASHBOARD_URL = "dashboard.html";
export const LOGIN_URL = "login.html#signin";

/* Step 1: create the account, save the full name and the database record, then sign out
   so the student continues to Step 2 (sign in), as in the design. */
export async function signUpWithEmail({ name, email, password, beforeSave }) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  try {
    await updateProfile(cred.user, { displayName: name });
  } catch (err) {
    console.warn("Could not save the display name:", err);
  }
  // beforeSave (from the sign up page) confirms the parent's approval and returns the level fields.
  // If anything about the level or the consent cannot be saved, the new account is removed again.
  try {
    const extra = beforeSave ? await beforeSave(cred.user) : {};
    // Save the student in the database while they are still signed in
    if (beforeSave) await saveUserProfileStrict(cred.user, extra);
    else await saveUserProfileSafe(cred.user, extra);
  } catch (err) {
    await removeNewAccount(cred.user);
    throw err;
  }
  await signOut(auth);
}

/* A brand new account that cannot finish sign up is removed, so nothing half made is left behind */
export async function removeNewAccount(user) {
  try {
    await user.delete();
  } catch (err) {
    console.warn("Could not remove the new account, signing out instead:", err);
    try { await signOut(auth); } catch (e) { /* nothing more to do */ }
  }
}

/* Step 2: sign in. "Remember me" decides if they stay signed in after closing the browser. */
export async function signInWithEmail({ email, password, remember }) {
  await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence);
  return signInWithEmailAndPassword(auth, email, password);
}

/* Google works for both sign up and sign in. A record is saved only the first time. */
export async function signInWithGoogle({ beforeSave } = {}) {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  const cred = await signInWithPopup(auth, provider);
  // Google has one button for sign up and sign in, so save only when the account is brand new.
  const info = getAdditionalUserInfo(cred);
  const isNew = Boolean(info && info.isNewUser);
  if (isNew) {
    try {
      // From the sign up page the level is already chosen. From the login page it is not,
      // so the account is marked "levelPending" and the app sends the student to "Who are you?" before anything else.
      const extra = beforeSave ? await beforeSave(cred.user) : { levelPending: true };
      await saveUserProfileStrict(cred.user, extra);
    } catch (err) {
      await removeNewAccount(cred.user);
      throw err;
    }
  }
  return { cred, isNew };
}

/* Sends the reset email */
export function resetPassword(email) {
  return sendPasswordResetEmail(auth, email);
}

/* Checks that the code from the email link is still valid. Returns the student's email. */
export function checkResetCode(code) {
  return verifyPasswordResetCode(auth, code);
}

/* Saves the new password */
export function completePasswordReset(code, newPassword) {
  return confirmPasswordReset(auth, code, newPassword);
}

/* This device stops receiving this student's pushes first (so the next person on a shared computer gets none).
   It waits 3 seconds at most, and a problem there never stops the sign out. */
export async function logOut() {
  const user = auth.currentUser;
  if (user) {
    try {
      const push = await import("./push.js");
      await Promise.race([push.detachThisDevice(user), new Promise((resolve) => setTimeout(resolve, 3000))]);
    } catch (err) {
      console.error("Push clean up skipped:", err);
    }
  }
  return signOut(auth);
}

/* Use this on every private page (dashboard and so on).
   It sends signed out visitors to the login page, quietly repairs a missing
   database record, then runs your function with the signed in student. */
export function requireAuth(onReady) {
  return onAuthStateChanged(auth, (user) => {
    if (!user) {
      window.location.replace(LOGIN_URL);
      return;
    }
    ensureUserProfile(user); // no waiting, the page does not slow down
    levelGate(user).then((open) => { if (open) onReady(user); });
  });
}

/* A new Google account that has not chosen "Who are you?" yet (levelPending) cannot use the app until it has.
   After one good check the browser remembers it, so this costs nothing later. A read problem never locks a student out. */
const LEVEL_PAGE = "who-are-you.html?finish=1";
const levelKey = (uid) => "trackly_level_ok_" + uid;
async function levelGate(user) {
  try {
    if (localStorage.getItem(levelKey(user.uid)) === "1") return true;
  } catch (err) { /* blocked storage: check every time */ }
  try {
    const record = await fetchUserRecord(user.uid);
    if (record && record.levelPending === true) {
      window.location.replace(LEVEL_PAGE);
      return false;
    }
    try { localStorage.setItem(levelKey(user.uid), "1"); } catch (err) { /* ignore */ }
  } catch (err) {
    console.warn("Could not check the student level:", err);
  }
  return true;
}

/* Runs your function now and every time someone signs in or out. */
export function watchAuth(callback) {
  return onAuthStateChanged(auth, callback);
}

/* Turns Firebase error codes into messages a student can understand.
   Returns "" when the student just closed the Google window (no message needed). */
const MESSAGES = {
  "auth/email-already-in-use": "An account with this email already exists. Try signing in instead.",
  "auth/invalid-email": "That email address does not look right.",
  "auth/weak-password": "Choose a stronger password with at least 8 characters.",
  "auth/invalid-credential": "Email or password is incorrect.",
  "auth/user-not-found": "Email or password is incorrect.",
  "auth/wrong-password": "Email or password is incorrect.",
  "auth/expired-action-code": "This reset link has expired. Request a new one.",
  "auth/invalid-action-code": "This reset link is not valid, or it was already used. Request a new one.",
  "auth/user-disabled": "This account has been disabled. Please contact support.",
  "auth/too-many-requests": "Too many attempts. Please wait a few minutes and try again.",
  "auth/network-request-failed": "Network problem. Check your connection and try again.",
  "auth/popup-blocked": "Your browser blocked the Google window. Allow pop-ups for this site and try again.",
  "auth/account-exists-with-different-credential": "This email is already registered another way. Sign in with your email and password instead.",
  "auth/operation-not-allowed": "This sign in method is not switched on yet. Enable it in Firebase, under Authentication, Sign-in method.",
  "auth/unauthorized-domain": "This web address is not allowed yet. In Firebase, add it under Authentication, Settings, Authorized domains."
};

const SILENT = ["auth/popup-closed-by-user", "auth/cancelled-popup-request"];

export function friendlyError(err) {
  const code = err && err.code ? err.code : "";
  if (SILENT.includes(code)) return "";
  if (err && err.name === "ConsentError") return consentErrorMessage(err.code);
  console.error("Firebase error:", err);
  return MESSAGES[code] || "Something went wrong. Please try again.";
}
