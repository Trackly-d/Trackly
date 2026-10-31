/* ==========================================================
   TRACKLY consent logic (pure: no Firebase, no page, tested in Node)
   Shared by the website AND the consent Worker (worker-consent/ imports this file).
   - how a parent email is checked and shown
   - what the sign up journey remembers between screens (kept in sessionStorage, gone when the tab closes)
   - which screen a consent status belongs to
   - which fields are saved on a student's record
   Nothing here touches a student's name, email or password.
   ========================================================== */

export const LEVELS = ["higher", "secondary"];
export const FLOW_KEY = "trackly:signup";
export const EXPIRY_DAYS = 7;
export const POLL_MS = 8000;               // how often the waiting screen asks if the parent answered
export const POLL_STOP_MS = 10 * 60000;    // after 10 minutes it stops asking by itself (the student can tap to check again)

/* Returns the cleaned email, or "" when it is not usable. Strict on purpose: it is going into an email header. */
export function normalizeParentEmail(raw) {
  const email = String(raw == null ? "" : raw).trim().toLowerCase();
  if (email.length < 6 || email.length > 254) return "";
  if (/[\s,;<>()"'\\\u0000-\u001f]/.test(email)) return "";
  const m = /^([^@]{1,64})@([^@]+)$/.exec(email);
  if (!m) return "";
  const domain = m[2];
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain)) return "";
  if (m[1].startsWith(".") || m[1].endsWith(".") || m[1].includes("..")) return "";
  return email;
}

/* "parent@gmail.com" becomes "p***@gmail.com" (this is the only form kept for display) */
export function maskEmail(email) {
  const [name, domain] = String(email).split("@");
  if (!name || !domain) return "";
  return name[0] + "***@" + domain;
}

/* ---------- what the journey remembers ----------
   flow: { level, requestId, parentMask, finishing }
   storage is sessionStorage in the browser (any object with getItem, setItem, removeItem works in tests). */
export function readFlow(storage) {
  try {
    const flow = JSON.parse(storage.getItem(FLOW_KEY) || "null");
    if (!flow || !LEVELS.includes(flow.level)) return null;
    return {
      level: flow.level,
      requestId: /^[\w-]{16,64}$/.test(flow.requestId || "") ? flow.requestId : "",
      parentMask: typeof flow.parentMask === "string" ? flow.parentMask.slice(0, 80) : "",
      finishing: flow.finishing === true
    };
  } catch (err) {
    return null;
  }
}

export function writeFlow(storage, flow) {
  try { storage.setItem(FLOW_KEY, JSON.stringify(flow)); return true; } catch (err) { return false; }
}

export function clearFlow(storage) {
  try { storage.removeItem(FLOW_KEY); } catch (err) { /* nothing to clear */ }
}

/* Where the sign up page must send the student, or "ok" to stay.
   hasRequest: the student already asked a parent. */
export function signupGate(flow) {
  if (!flow) return "who-are-you.html";
  if (flow.level === "higher") return "ok";
  return flow.requestId ? "check" : "parental-consent.html";
}

/* The card view for each status the Worker can report */
export function viewForStatus(status) {
  if (status === "pending") return "sent";
  if (status === "approved") return "approved";
  if (status === "declined") return "declined";
  return "expired"; // expired, unknown or anything odd: start again
}

/* What is saved on the student's record. approvedAt is the time the parent approved (from the Worker). */
export function levelFields({ level, approvedAt = null, requestId = "" }) {
  if (level === "secondary") {
    return { studentLevel: "secondary", parentalConsent: true, parentalConsentAt: approvedAt, consentRequestId: requestId };
  }
  return { studentLevel: "higher" };
}

/* May the form's button be used right now? */
export function canSendRequest({ email, aware, busy }) {
  return !busy && Boolean(aware) && normalizeParentEmail(email) !== "";
}

/* The form's problems, as { email, aware } messages (empty when fine) */
export function formProblems({ email, aware }) {
  return {
    email: normalizeParentEmail(email) ? "" : "Enter a valid email address.",
    aware: aware ? "" : "Please tick the box to continue."
  };
}
