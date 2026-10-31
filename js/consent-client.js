/* ==========================================================
   TRACKLY consent client
   The website's way of talking to the consent Worker. The first four calls need no sign in (the student has no account yet,
   and the parent never will). claim and deleteAccountData prove who the student is with their Firebase sign in.
   Built so it can be tested without a browser: fetch and the token reader are handed in.
   ========================================================== */

import { CONSENT_WORKER_URL } from "./consent-config.js";

export class ConsentError extends Error {
  constructor(code, status = 0) {
    super(code);
    this.name = "ConsentError";
    this.code = code;
    this.status = status;
  }
}

const MESSAGES = {
  bad_email: "Enter a valid email address.",
  too_many: "Too many requests from this device. Please try again in an hour.",
  busy: "Approval emails are very busy today. Please try again tomorrow.",
  email_failed: "We could not send the email. Check the address and try again.",
  network: "We could not reach Trackly. Check your connection and try again.",
  timeout: "Trackly is taking too long. Please try again.",
  sign_in_needed: "Please sign in again, then try once more.",
  already_used: "This approval was already used for another account. Please ask your parent for a new one.",
  not_approved: "We could not confirm your parent's approval. Please start again.",
  not_found: "We could not find your parent's approval. Please start again.",
  not_configured: "Parental approval is not set up yet. Please try again later."
};

export function consentErrorMessage(code) {
  return MESSAGES[code] || "Something went wrong. Please try again.";
}

export function createConsentClient({ workerUrl = CONSENT_WORKER_URL, fetchFn = (...args) => fetch(...args), timeoutMs = 15000 } = {}) {
  const base = String(workerUrl).replace(/\/+$/, "");

  async function post(path, body, token) {
    const headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = "Bearer " + token;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await fetchFn(base + path, { method: "POST", headers, body: JSON.stringify(body || {}), signal: controller.signal });
    } catch (err) {
      throw new ConsentError(err && err.name === "AbortError" ? "timeout" : "network");
    } finally {
      clearTimeout(timer);
    }
    const data = await res.json().catch(() => ({}));
    // a parent answering twice is not an error to show, the page just reads the status
    if (!res.ok && !(res.status === 409 && data.status)) throw new ConsentError(data.error || "server", res.status);
    return data;
  }

  const authed = async (getToken) => {
    try { return await getToken(); } catch (err) { throw new ConsentError("sign_in_needed", 401); }
  };

  return {
    /* Emails the parent. Returns { id, expiresAt }. */
    request: (parentEmail) => post("/consent/request", { parentEmail }),
    /* The student's page: { status } is pending, approved, declined, expired or unknown */
    status: (id) => post("/consent/status", { id }),
    /* The parent's page: { status } for the link they opened */
    lookup: (token) => post("/consent/lookup", { token }),
    /* The parent's answer. decision is "approve" or "decline". Returns { status }. */
    answer: (token, decision) => post("/consent/answer", { token, decision }),
    /* The new account uses the approval. Returns { approvedAt }. */
    claim: async (id, getToken) => post("/consent/claim", { id }, await authed(getToken)),
    /* The account is being deleted */
    deleteAccountData: async (getToken) => post("/consent/delete-account", {}, await authed(getToken))
  };
}
