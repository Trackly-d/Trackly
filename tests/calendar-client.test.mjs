import { createCalendarClient, CalendarError, calendarErrorMessage } from "../js/calendar-client.js";

let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(ok ? "PASS" : "FAIL", name, ok ? "" : "got " + JSON.stringify(got) + " want " + JSON.stringify(want));
};

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
const calls = [];

function client(handler, options = {}) {
  calls.length = 0;
  return createCalendarClient({
    workerUrl: "https://worker.example/",
    getToken: async () => "FIREBASE_TOKEN",
    fetchFn: async (url, init) => { calls.push({ url, ...init }); return handler(url, init); },
    ...options
  });
}

async function fails(promise) {
  try { await promise; return null; } catch (err) { return err; }
}

// status and the sign in header
let c = client(() => json({ status: "connected", connectedAt: "2026-10-13T10:00:00Z" }));
check("status", await c.status(), { status: "connected", connectedAt: "2026-10-13T10:00:00Z" });
check("address has no double slash", calls[0].url, "https://worker.example/calendar/status");
check("GET method", calls[0].method, "GET");
check("sends the sign in token", calls[0].headers.Authorization, "Bearer FIREBASE_TOKEN");
check("no body header on a GET", "Content-Type" in calls[0].headers, false);

// connect link
c = client(() => json({ url: "https://accounts.google.com/o/oauth2/v2/auth?x=1" }));
check("connect link", await c.startConnect(), "https://accounts.google.com/o/oauth2/v2/auth?x=1");
check("connect is a POST", calls[0].method, "POST");
c = client(() => json({ url: "https://evil.example/phish" }));
let err = await fails(c.startConnect());
check("a link that is not Google is refused", err && err.code, "google");
c = client(() => json({}));
check("no link is refused", (await fails(c.startConnect())).code, "google");

// errors from the Worker
c = client(() => json({ error: "reconnect" }, 409));
err = await fails(c.status());
check("worker error code kept", [err instanceof CalendarError, err.code, err.status], [true, "reconnect", 409]);
c = client(() => json({ error: "origin_not_allowed" }, 403));
check("origin refused code", (await fails(c.startConnect())).code, "origin_not_allowed");
c = client(() => new Response("<html>oops</html>", { status: 500 }));
check("a broken answer becomes a Google problem", (await fails(c.status())).code, "google");
c = client(() => { throw new TypeError("Failed to fetch"); });
check("no network", (await fails(c.status())).code, "network");
c = client(() => json({}), { getToken: async () => { throw new Error("signed out"); } });
check("not signed in", (await fails(c.status())).code, "sign_in_needed");
c = client((url, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })))), { timeoutMs: 30 });
check("a slow Worker times out", (await fails(c.status())).code, "timeout");

// events
c = client(() => json({ events: [{ kind: "due", id: "abcde001" }] }));
check("create events", await c.createEvents({ assignmentId: "a1" }), [{ kind: "due", id: "abcde001" }]);
check("create sends json", [calls[0].url, calls[0].headers["Content-Type"], JSON.parse(calls[0].body)], ["https://worker.example/calendar/events", "application/json", { assignmentId: "a1" }]);
c = client(() => json({}));
check("no events answer is an empty list", await c.createEvents({}), []);

// deleting in groups of ten
c = client((url, init) => json({ deleted: JSON.parse(init.body).eventIds.length }));
const ids = Array.from({ length: 25 }, (_, i) => "abcde" + String(100 + i));
check("delete counts everything", await c.deleteEvents(ids), 25);
check("delete goes ten at a time", calls.map((x) => JSON.parse(x.body).eventIds.length), [10, 10, 5]);
check("deleting nothing makes no call", [await client(() => json({})).deleteEvents([]), calls.length], [0, 0]);

// disconnecting in rounds
let round = 0;
c = client(() => { round++; return json(round < 3 ? { done: false, removed: 30 } : { done: true, removed: 12 }); });
const progress = [];
check("disconnect keeps asking until done", await c.disconnect({ onProgress: (n) => progress.push(n) }), { removed: 72, unreachable: false });
check("progress is reported", progress, [30, 60, 72]);
c = client(() => json({ done: true, removed: 0, unreachable: true }));
check("unreachable is passed on", await c.disconnect(), { removed: 0, unreachable: true });
c = client(() => json({ done: false, removed: 1 }));
check("endless clean up gives up", (await fails(c.disconnect({ maxRounds: 3 }))).code, "google");
check("rounds were limited", calls.length, 3);
c = client(() => json({ error: "google" }, 502));
check("disconnect error is passed on", (await fails(c.disconnect())).code, "google");

// messages
check("known message", calendarErrorMessage("reconnect").includes("connect"), true);
check("unknown code still has a sentence", calendarErrorMessage("zzz").length > 10, true);
check("every code the Worker sends has a message", ["sign_in_needed", "not_connected", "reconnect", "origin_not_allowed", "not_configured", "network", "timeout", "google"].every((k) => calendarErrorMessage(k) !== calendarErrorMessage("zzz")), true);

console.log(failed ? failed + " FAILED" : "ALL PASSED");
process.exit(failed ? 1 : 0);
