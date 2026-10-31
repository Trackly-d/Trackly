import { createConsentClient, ConsentError, consentErrorMessage } from "../js/consent-client.js";

let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(ok ? "PASS" : "FAIL", name, ok ? "" : "got " + JSON.stringify(got) + " want " + JSON.stringify(want));
};

const calls = [];
let reply = { status: 200, data: { ok: true } };
const fetchFn = async (url, init) => { calls.push({ url, ...init }); return new Response(JSON.stringify(reply.data), { status: reply.status, headers: { "Content-Type": "application/json" } }); };
const client = createConsentClient({ workerUrl: "https://consent.example/", fetchFn });

reply = { status: 200, data: { id: "I".repeat(22), expiresAt: "2026-11-07T00:00:00.000Z" } };
let r = await client.request("mum@example.com");
check("request posts the parent email and needs no sign in", [calls[0].url, calls[0].method, JSON.parse(calls[0].body), calls[0].headers.Authorization], ["https://consent.example/consent/request", "POST", { parentEmail: "mum@example.com" }, undefined]);
check("it returns the public code", r.id.length, 22);
reply = { status: 200, data: { status: "pending" } };
check("status asks with the public code", [(await client.status("abc")).status, calls[1].url, JSON.parse(calls[1].body)], ["pending", "https://consent.example/consent/status", { id: "abc" }]);
await client.lookup("tok");
check("lookup sends the secret from the link", [calls[2].url, JSON.parse(calls[2].body)], ["https://consent.example/consent/lookup", { token: "tok" }]);
await client.answer("tok", "approve");
check("answer sends the decision", [calls[3].url, JSON.parse(calls[3].body)], ["https://consent.example/consent/answer", { token: "tok", decision: "approve" }]);
reply = { status: 200, data: { approvedAt: "2026-11-01T10:00:00.000Z" } };
r = await client.claim("abc", async () => "TOKEN");
check("claim proves who the student is", [calls[4].url, calls[4].headers.Authorization, r.approvedAt], ["https://consent.example/consent/claim", "Bearer TOKEN", "2026-11-01T10:00:00.000Z"]);
await client.deleteAccountData(async () => "TOKEN");
check("deleting the record needs the sign in too", [calls[5].url, calls[5].headers.Authorization], ["https://consent.example/consent/delete-account", "Bearer TOKEN"]);

// problems become plain codes
reply = { status: 400, data: { error: "bad_email" } };
let e = await client.request("x").catch((x) => x);
check("the Worker's reason is kept", [e instanceof ConsentError, e.code, e.status], [true, "bad_email", 400]);
reply = { status: 429, data: { error: "too_many" } };
check("too many asks", (await client.request("a@b.co").catch((x) => x)).code, "too_many");
reply = { status: 409, data: { error: "not_pending", status: "approved" } };
r = await client.answer("tok", "decline");
check("a parent answering twice is not an error, the page just reads the status", r.status, "approved");
reply = { status: 409, data: { error: "already_used" } };
check("an approval used twice is an error", (await client.claim("abc", async () => "T").catch((x) => x)).code, "already_used");
reply = { status: 500, data: {} };
check("no reason from the Worker becomes server", (await client.status("abc").catch((x) => x)).code, "server");

const offline = createConsentClient({ workerUrl: "https://consent.example", fetchFn: async () => { throw new TypeError("Failed to fetch"); } });
check("no internet", (await offline.request("a@b.co").catch((x) => x)).code, "network");
const slow = createConsentClient({ workerUrl: "https://consent.example", timeoutMs: 20, fetchFn: (url, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(Object.assign(new Error("a"), { name: "AbortError" })))) });
check("a slow Worker times out", (await slow.status("abc").catch((x) => x)).code, "timeout");
const noUser = createConsentClient({ workerUrl: "https://consent.example", fetchFn });
check("no sign in token", (await noUser.claim("abc", async () => { throw new Error("none"); }).catch((x) => x)).code, "sign_in_needed");

const codes = ["bad_email", "too_many", "busy", "email_failed", "network", "timeout", "sign_in_needed", "already_used", "not_approved", "not_found", "not_configured", "unknown"];
check("every code has a plain sentence", codes.every((c) => consentErrorMessage(c).length > 15), true);
check("no technical words reach the student", codes.every((c) => !/worker|token|http|cors|d1|resend/i.test(consentErrorMessage(c))), true);

console.log(failed ? failed + " FAILED" : "ALL PASSED");
process.exit(failed ? 1 : 0);
