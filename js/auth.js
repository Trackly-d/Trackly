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
import { saveUserProfileSafe, ensureUserProfile } from "./users.js";

// Where students go after signing in, and where signed out students are sent.
export const DASHBOARD_URL = "dashboard.html";
export const LOGIN_URL = "login.html#signin";

/* Step 1: create the account, save the full name and the database record, then sign out
   so the student continues to Step 2 (sign in), as in the design. */
export async function signUpWithEmail({ name, email, password }) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  try {
    await updateProfile(cred.user, { displayName: name });
  } catch (err) {
    console.warn("Could not save the display name:", err);
  }
  // Save the student in the database while they are still signed in
  await saveUserProfileSafe(cred.user);
  await signOut(auth);
}

/* Step 2: sign in. "Remember me" decides if they stay signed in after closing the browser. */
export async function signInWithEmail({ email, password, remember }) {
  await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence);
  return signInWithEmailAndPassword(auth, email, password);
}

/* Google works for both sign up and sign in. A record is saved only the first time. */
export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  const cred = await signInWithPopup(auth, provider);
  // Google has one button for sign up and sign in, so save only when the account is brand new.
  const info = getAdditionalUserInfo(cred);
  if (info && info.isNewUser) await saveUserProfileSafe(cred.user);
  return cred;
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

export function logOut() {
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
    onReady(user);
  });
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
  console.error("Firebase error:", err);
  return MESSAGES[code] || "Something went wrong. Please try again.";
}