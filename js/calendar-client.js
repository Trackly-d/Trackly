/* ==========================================================
   TRACKLY calendar client
   The website's way of talking to the calendar Worker. It sends the student's Firebase sign in
   with every call, so the Worker knows who is asking. No Google token ever reaches the browser,
   and nothing is saved in the browser.

   Built so it can be tested without a browser: the sign in token and fetch are handed in.
   Used by Profile now (connect, status, disconnect). Add, Single and Edit use createEvents and
   deleteEvents in the next step.
   ========================================================== */

import { CALENDAR_WORKER_URL } from "./calendar-config.js";

export class CalendarError extends Error {
  constructor(code, status = 0) {
    super(code);
    this.name = "CalendarError";
    this.code = code;
    this.status = status;
  }
}

const MESSAGES = {
  sign_in_needed: "Please sign in again, then try once more.",
  not_connected: "Google Calendar is not connected.",
  reconnect: "Google needs you to connect Google Calendar again.",
  origin_not_allowed: "This website is not allowed to use Google Calendar yet.",
  not_configured: "Google Calendar is not set up yet.",
  network: "We could not reach Google Calendar. Check your connection and try again.",
  timeout: "Google Calendar is taking too long. Please try again.",
  google: "Google Calendar had a problem. Please try again."
};

/* A plain sentence for any error code from the Worker or from this client */
export function calendarErrorMessage(code) {
  return MESSAGES[code] || "Something went wrong with Google Calendar. Please try again.";
}

const GOOGLE_SIGN_IN = /^https:\/\/accounts\.google\.com\//;

export function createCalendarClient({ workerUrl = CALENDAR_WORKER_URL, getToken, fetchFn = (...args) => fetch(...args), timeoutMs = 20000 }) {
  const base = String(workerUrl).replace(/\/+$/, "");

  async function request(method, path, body) {
    let token;
    try { token = await getToken(); } catch (err) { throw new CalendarError("sign_in_needed", 401); }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      const headers = { Authorization: "Bearer " + token };
      if (body) headers["Content-Type"] = "application/json";
      res = await fetchFn(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: controller.signal });
    } catch (err) {
      throw new CalendarError(err && err.name === "AbortError" ? "timeout" : "network");
    } finally {
      clearTimeout(timer);
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new CalendarError(data.error || "google", res.status);
    return data;
  }

  return {
    /* { status: "connected" | "disconnected" | "reconnect", connectedAt } */
    status: () => request("GET", "/calendar/status"),

    /* The Google permission link. The page sends the student there. */
    async startConnect() {
      const data = await request("POST", "/google/start");
      if (!data.url || !GOOGLE_SIGN_IN.test(data.url)) throw new CalendarError("google");
      return data.url;
    },

    /* payload: { assignmentId, title, courseName, timeZone, due, dueMinutes, daily } (see the Worker). Returns [{ kind, id }] */
    async createEvents(payload) {
      return (await request("POST", "/calendar/events", payload)).events || [];
    },

    /* Removes events by id, ten at a time. Returns how many are gone. */
    async deleteEvents(ids) {
      let deleted = 0;
      for (let i = 0; i < ids.length; i += 10) {
        deleted += (await request("POST", "/calendar/delete", { eventIds: ids.slice(i, i + 10) })).deleted || 0;
      }
      return deleted;
    },

    /* Removes every Trackly reminder and disconnects. The Worker works in batches, so this asks again until it is done. */
    async disconnect({ onProgress, maxRounds = 20 } = {}) {
      let removed = 0;
      for (let round = 0; round < maxRounds; round++) {
        const data = await request("POST", "/calendar/disconnect");
        removed += data.removed || 0;
        if (onProgress) onProgress(removed);
        if (data.done) return { removed, unreachable: Boolean(data.unreachable) };
      }
      throw new CalendarError("google");
    }
  };
}