/* ==========================================================
   TRACKLY profile rules (pure logic, no Firebase, tested without a browser)
   Name, initials, which photo to show, password checks and friendly password messages.

   Photo order: the student's own upload, then their Google photo, then initials.
   Password: accounts that already have a password "change" it (current password needed).
   Google only accounts "set" one (they sign in with Google again first), after which both ways work.
   ========================================================== */

export const NAME_MIN = 2;
export const NAME_MAX = 60;
export const PASSWORD_MIN = 8;
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024; // same as course photos
export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

/* Trimmed, single spaced name, and a message if it is not acceptable */
export function validateName(raw) {
  const name = String(raw == null ? "" : raw).trim().replace(/\s+/g, " ");
  if (name.length < NAME_MIN) return { ok: false, name, error: "Enter your full name." };
  if (name.length > NAME_MAX) return { ok: false, name, error: "Keep your name under " + NAME_MAX + " characters." };
  return { ok: true, name, error: "" };
}

/* "Alex Rivers" gives "AR". Without a name, the start of the email is used. */
export function initialsOf(name, email) {
  const base = String(name || "").trim() || (email ? String(email).split("@")[0] : "");
  const letters = base.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word.charAt(0).toUpperCase()).join("");
  return letters || "S";
}

/* The photo Google gave this account, kept in the Google entry of providerData */
export function googlePhotoOf(providerData) {
  const entry = (providerData || []).find((p) => p && p.providerId === "google.com");
  return entry && entry.photoURL ? entry.photoURL : "";
}

export function photoToShow({ custom, google }) {
  return custom || google || "";
}

/* "change" when the account already has a password, otherwise "set" */
export function passwordMode(providerData) {
  return (providerData || []).some((p) => p && p.providerId === "password") ? "change" : "set";
}

/* Returns { ok, error, field } where field is "current", "next" or "confirm" */
export function validatePasswordForm({ current = "", next = "", confirm = "" }, mode) {
  if (mode === "change" && !current) return { ok: false, field: "current", error: "Enter your current password." };
  if (next.length < PASSWORD_MIN) return { ok: false, field: "next", error: "Password must be at least " + PASSWORD_MIN + " characters long." };
  if (mode === "change" && next === current) return { ok: false, field: "next", error: "Choose a password that is different from the current one." };
  if (confirm !== next) return { ok: false, field: "confirm", error: "The new passwords do not match." };
  return { ok: true, field: "", error: "" };
}

const PASSWORD_MESSAGES = {
  "auth/wrong-password": "Your current password is not right.",
  "auth/invalid-credential": "Your current password is not right.",
  "auth/weak-password": "Choose a stronger password with at least 8 characters.",
  "auth/requires-recent-login": "For your safety, please sign in again, then try once more.",
  "auth/too-many-requests": "Too many attempts. Please wait a few minutes and try again.",
  "auth/network-request-failed": "Network problem. Check your connection and try again.",
  "auth/provider-already-linked": "This account already has a password. Reload the page and use Change Password.",
  "auth/credential-already-in-use": "This account already has a password. Reload the page and use Change Password.",
  "auth/email-already-in-use": "This account already has a password. Reload the page and use Change Password.",
  "auth/popup-blocked": "Your browser blocked the Google window. Allow pop-ups for this site and try again.",
  "auth/user-mismatch": "Choose the same Google account you are signed in with."
};

/* A message for a Firebase error code, or "" when this module has none (the page then uses friendlyError) */
export function passwordError(code) {
  return PASSWORD_MESSAGES[code] || "";
}

/* "Member since Oct 2026" */
export function memberSinceText(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  return "Member since " + date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

/* A message if the chosen photo cannot be used, otherwise "" */
export function validatePhotoFile(file) {
  if (!file || !PHOTO_TYPES.includes(file.type)) return "Choose a JPG, PNG or WebP photo.";
  if (file.size > MAX_PHOTO_BYTES) return "That photo is too large. Choose one under 10 MB.";
  return "";
}

/* ---------- Google Calendar on the Profile page ---------- */

/* What to tell the student when Google sends them back to Profile (?calendar=...). null for anything else. */
export function calendarReturn(flag) {
  if (flag === "connected") return { kind: "ok", message: "Google Calendar connected" };
  if (flag === "denied") return { kind: "problem", message: "Google Calendar was not connected, because access was not allowed." };
  if (flag === "error") return { kind: "problem", message: "Something went wrong connecting Google Calendar. Please try again." };
  return null;
}

/* The Worker is the truth. The "connected" note on the student's record is only a display hint.
   Returns { state: "on" | "off" | "reconnect", flag: "keep" | "set" | "clear" } */
export function reconcileCalendar(flagConnected, workerStatus) {
  if (workerStatus === "connected") return { state: "on", flag: flagConnected ? "keep" : "set" };
  if (workerStatus === "disconnected") return { state: "off", flag: flagConnected ? "clear" : "keep" };
  if (workerStatus === "reconnect") return { state: "reconnect", flag: "keep" };
  return { state: flagConnected ? "on" : "off", flag: "keep" }; // could not tell: show what we last knew
}