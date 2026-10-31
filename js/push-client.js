/* ==========================================================
   TRACKLY push client
   The website's way of talking to the push Worker. It sends the student's Firebase sign in with every call, so the
   Worker knows who is asking. Built so it can be tested without a browser: the sign in token and fetch are handed in.
   ========================================================== */

import { PUSH_WORKER_URL } from "./push-config.js";

export class PushError extends Error {
  constructor(code, status = 0) {
    super(code);
    this.name = "PushError";
    this.code = code;
    this.status = status;
  }
}

const MESSAGES = {
  sign_in_needed: "Please sign in again, then try once more.",
  origin_not_allowed: "This website is not allowed to use push yet.",
  not_configured: "Push notifications are not set up yet.",
  network: "We could not reach Trackly. Check your connection and try again.",
  timeout: "Trackly is taking too long. Please try again.",
  bad_subscription: "This browser's push address was not accepted."
};

export function pushErrorMessage(code) {
  return MESSAGES[code] || "Something went wrong with push notifications. Please try again.";
}

export function createPushClient({ workerUrl = PUSH_WORKER_URL, getToken, fetchFn = (...args) => fetch(...args), timeoutMs = 15000 }) {
  const base = String(workerUrl).replace(/\/+$/, "");

  /* keepalive lets a small request finish even if the page changes right after saving */
  async function post(path, body, { keepalive = false } = {}) {
    let token;
    try { token = await getToken(); } catch (err) { throw new PushError("sign_in_needed", 401); }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await fetchFn(base + path, {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify(body || {}),
        signal: controller.signal,
        keepalive
      });
    } catch (err) {
      throw new PushError(err && err.name === "AbortError" ? "timeout" : "network");
    } finally {
      clearTimeout(timer);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new PushError(data.error || "server", res.status);
    return data;
  }

  return {
    /* subscription: the browser's PushSubscription as plain data (subscription.toJSON()). Returns { devices } */
    subscribe: (subscription) => post("/push/subscribe", { subscription }),
    unsubscribe: (endpoint) => post("/push/unsubscribe", { endpoint }),
    /* { alertsEnabled, alertHours, types } */
    prefs: (prefs) => post("/push/prefs", prefs),
    /* items: up to 25 of { assignmentId, title, courseName, dueAt, createdAt, status }. Sent 25 at a time. */
    async watch(items) {
      for (let i = 0; i < items.length; i += 25) await post("/push/watch", { items: items.slice(i, i + 25) }, { keepalive: true });
    },
    /* { kind, id, title, courseName } */
    event: (payload) => post("/push/event", payload, { keepalive: true }),
    deleteAll: () => post("/push/delete-all", {})
  };
}
