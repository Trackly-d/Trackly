/* ==========================================================
   TRACKLY finishing a sign up that started with Google
   "Continue with Google" makes the account at once, before the student has said "Who are you?". Such an account is marked
   levelPending and cannot use the app until this is done (see levelGate in js/auth.js):
     - Higher Institution:  save the level, go to the dashboard
     - Secondary School:    claim the parent's approval, save the level and the consent record, go to the dashboard
     - the student backs out, or the parent declines: the new account is deleted and the student goes to the home page
   Loaded only when the page is opened with ?finish=1, so the public pages stay light.
   ========================================================== */

import { auth, db, doc, setDoc, deleteField, onAuthStateChanged, signOut } from "./firebase-config.js";
import { createConsentClient } from "./consent-client.js";
import { levelFields, clearFlow } from "./consent-logic.js";
import { removeNewAccount, DASHBOARD_URL, LOGIN_URL } from "./auth.js";
import { invalidateCache } from "./cache.js";

/* Resolves with the signed in student (or null) once Firebase has checked */
export function currentStudent() {
  return new Promise((resolve) => {
    const stop = onAuthStateChanged(auth, (user) => { stop(); resolve(user); });
  });
}

/* flow: { level, requestId }. Saves the level, clears the pending mark, and goes to the dashboard. */
export async function completeLevel(user, flow) {
  let fields;
  if (flow.level === "secondary") {
    const claim = await createConsentClient().claim(flow.requestId, () => user.getIdToken());
    fields = levelFields({ level: "secondary", approvedAt: new Date(claim.approvedAt), requestId: flow.requestId });
  } else {
    fields = levelFields({ level: "higher" });
  }
  await setDoc(doc(db, "users", user.uid), { ...fields, levelPending: deleteField() }, { merge: true });
  try { localStorage.setItem("trackly_level_ok_" + user.uid, "1"); } catch (err) { /* ignore */ }
  invalidateCache(user.uid);
  clearFlow(window.sessionStorage);
  window.location.assign(DASHBOARD_URL);
}

/* The student chose not to go on, or the parent declined: nothing is kept */
export async function abandonNewAccount(user) {
  clearFlow(window.sessionStorage);
  if (user) {
    try { await removeNewAccount(user); } catch (err) { /* removeNewAccount already signs out if it cannot delete */ }
  } else {
    try { await signOut(auth); } catch (err) { /* nothing to do */ }
  }
  window.location.replace("index.html");
}

export { LOGIN_URL };
