/* ==========================================================
   TRACKLY delete account (logic only, tested without a browser)
   The steps, in order, and what to do when one of them goes wrong. The page hands in the real functions.

     1. check the student's sign in again (a password, or Google)
     2. remove the reminders from Google Calendar
     3. remove the photos
     4. delete courses, assignments and the rest of the data
     5. delete the login itself

   Every step can safely be run again, so a failure in the middle never traps the student:
   they press Delete again and it carries on. The login is deleted LAST on purpose.
   ========================================================== */

import { passwordError } from "./profile-rules.js";

/* Everything saved under users/{uid}. tests/account-delete.test.mjs checks this list against the code,
   so a new collection that is not listed here makes the test fail. */
export const DELETE_COLLECTIONS = ["assignments", "courses", "notifications", "calendarCleanup"];
export const CONFIRM_WORD = "DELETE";

export class AccountDeleteError extends Error {
  constructor(step, cause) {
    super(step);
    this.name = "AccountDeleteError";
    this.step = step;
    this.cause = cause;
  }
}

/* mode is "change" (the account has a password) or "set" (Google only). Returns { ok, field, error } */
export function validateDeleteForm({ typed = "", password = "" }, mode) {
  if (mode === "change" && !password) return { ok: false, field: "password", error: "Enter your password." };
  if (String(typed).trim() !== CONFIRM_WORD) return { ok: false, field: "typed", error: "Type " + CONFIRM_WORD + " in capital letters to confirm." };
  return { ok: true, field: "", error: "" };
}

export const TOLERATED_CALENDAR = ["reconnect", "not_connected"]; // nothing more we can remove: carry on

/* deps: { reauth, removeCalendar, removePhotos, removeData, removeLogin }, all async. onProgress(text, number, total). */
export async function deleteAccount({ deps, onProgress }) {
  const plan = [
    { step: "reauth", label: "Checking your sign in...", run: deps.reauth },
    { step: "calendar", label: "Removing your Google Calendar reminders...", run: deps.removeCalendar, tolerate: (err) => Boolean(err && TOLERATED_CALENDAR.includes(err.code)) },
    { step: "photos", label: "Removing your photos...", run: deps.removePhotos },
    { step: "data", label: "Deleting your courses, assignments and settings...", run: deps.removeData },
    { step: "login", label: "Deleting your account...", run: deps.removeLogin }
  ];
  for (let i = 0; i < plan.length; i++) {
    const item = plan[i];
    if (onProgress) onProgress(item.label, i + 1, plan.length);
    try {
      await item.run();
    } catch (err) {
      if (item.tolerate && item.tolerate(err)) continue;
      throw new AccountDeleteError(item.step, err);
    }
  }
  return { ok: true };
}

/* A plain sentence for a failed step. Returns "" when the student just closed the Google window. */
export function deleteMessage(error) {
  const step = error && error.step;
  const cause = error && error.cause;
  const code = cause && cause.code;
  if (step === "reauth") {
    if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return "";
    return passwordError(code) || "We could not confirm your sign in. Please try again.";
  }
  if (step === "calendar") return "We could not remove your Google Calendar reminders. Check your connection and try again.";
  if (step === "photos") return "We could not remove your photos. Check your connection and try again.";
  if (step === "data") return "We could not delete all of your data. Check your connection and try again.";
  if (step === "login") return "Your data is deleted, but we could not close your login. Press Delete my account once more.";
  return "Something went wrong. Please try again.";
}