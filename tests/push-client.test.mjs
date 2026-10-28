import { createPushClient, PushError, pushErrorMessage } from "../js/push-client.js";

let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(ok ? "PASS" : "FAIL", name, ok ? "" : "got " + JSON.stringify(got) + " want " + JSON.stringify(want));
};

const calls = [];
let reply = { status: 200, data: { devices: 2 } };
const fetchFn = async (url, init) => {
  calls.push({ url, ...init });
  return new Response(JSON.stringify(reply.data), { status: reply.status, headers: { "Content-Type": "application/json" } });
};
const client = createPushClient({ workerUrl: "https://push.example/", getToken: async () => "TOKEN", fetchFn });

let r = await client.subscribe({ endpoint: "https://fcm.googleapis.com/x", keys: { p256dh: "a", auth: "b" } });
check("subscribe returns the device count", r.devices, 2);
check("it posts to the right address with the student's sign in", [calls[0].url, calls[0].method, calls[0].headers.Authorization, calls[0].headers["Content-Type"]], ["https://push.example/push/subscribe", "POST", "Bearer TOKEN", "application/json"]);
check("the subscription travels in the body", JSON.parse(calls[0].body).subscription.endpoint, "https://fcm.googleapis.com/x");

await client.unsubscribe("https://fcm.googleapis.com/x");
check("unsubscribe path", calls[1].url, "https://push.example/push/unsubscribe");
await client.prefs({ alertsEnabled: true, alertHours: [48], types: { added: true } });
check("prefs path and body", [calls[2].url, JSON.parse(calls[2].body).alertHours], ["https://push.example/push/prefs", [48]]);
await client.event({ kind: "added", id: "a1", title: "T", courseName: "C", endpoint: "e" });
check("events can finish even if the page changes (keepalive)", [calls[3].url, calls[3].keepalive], ["https://push.example/push/event", true]);

calls.length = 0;
const items = Array.from({ length: 60 }, (_, i) => ({ assignmentId: "a" + i, status: "open" }));
await client.watch(items);
check("60 assignments go as 25, 25 and 10", calls.map((c) => JSON.parse(c.body).items.length), [25, 25, 10]);
calls.length = 0;
await client.deleteAll();
check("delete everything", calls[0].url, "https://push.example/push/delete-all");

// ---------- problems become plain codes
reply = { status: 403, data: { error: "origin_not_allowed" } };
let e = await client.prefs({}).catch((x) => x);
check("a Worker error keeps its code and status", [e instanceof PushError, e.code, e.status], [true, "origin_not_allowed", 403]);
reply = { status: 502, data: {} };
e = await client.prefs({}).catch((x) => x);
check("no code from the Worker becomes server", e.code, "server");

const offline = createPushClient({ workerUrl: "https://push.example", getToken: async () => "T", fetchFn: async () => { throw new TypeError("Failed to fetch"); } });
e = await offline.prefs({}).catch((x) => x);
check("no internet is the network code", e.code, "network");
const slow = createPushClient({ workerUrl: "https://push.example", getToken: async () => "T", timeoutMs: 20, fetchFn: (url, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(Object.assign(new Error("a"), { name: "AbortError" })))) });
e = await slow.prefs({}).catch((x) => x);
check("a slow Worker times out", e.code, "timeout");
const signedOut = createPushClient({ workerUrl: "https://push.example", getToken: async () => { throw new Error("no user"); }, fetchFn });
e = await signedOut.prefs({}).catch((x) => x);
check("no sign in token", [e.code, e.status], ["sign_in_needed", 401]);

check("every code has a plain sentence", ["sign_in_needed", "origin_not_allowed", "not_configured", "network", "timeout", "bad_subscription", "unknown"].every((c) => pushErrorMessage(c).length > 15), true);
check("none of them mention technical words", ["sign_in_needed", "network", "server"].every((c) => !/worker|token|http|cors/i.test(pushErrorMessage(c))), true);

console.log(failed ? failed + " FAILED" : "ALL PASSED");
process.exit(failed ? 1 : 0);
