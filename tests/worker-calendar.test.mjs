import { webcrypto } from "node:crypto";
import worker, { resetCaches } from "../worker-calendar/index.js";
import {
  b64encode, b64decode, encryptToken, decryptToken, signState, verifyState,
  verifyFirebaseToken, resetJwksCache, parseEventsRequest, buildEvents
} from "../worker-calendar/lib.js";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(ok ? "PASS" : "FAIL", name, ok ? "" : "got " + JSON.stringify(got) + " want " + JSON.stringify(want));
};

const enc = new TextEncoder();
const PROJECT = "trackly-e18d8";
const MASTER = b64encode(crypto.getRandomValues(new Uint8Array(32)));
const SITE = "http://localhost:5000";
const SCOPE = "https://www.googleapis.com/auth/calendar.events.owned";
const JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const CAL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

// ---------- a signing key standing in for Firebase, and a way to make sign in tokens
const algo = { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" };
const pair = await crypto.subtle.generateKey(algo, true, ["sign", "verify"]);
const otherPair = await crypto.subtle.generateKey(algo, true, ["sign", "verify"]);
const publicJwk = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid: "key1", alg: "RS256", use: "sig" };

async function makeToken(claims = {}, { key = pair.privateKey, kid = "key1", alg = "RS256" } = {}) {
  const sec = Math.floor(Date.now() / 1000);
  const payload = { aud: PROJECT, iss: "https://securetoken.google.com/" + PROJECT, sub: "student-1", iat: sec - 10, exp: sec + 3600, ...claims };
  const head = b64encode(enc.encode(JSON.stringify({ alg, kid, typ: "JWT" })), true);
  const body = b64encode(enc.encode(JSON.stringify(payload)), true);
  const sig = alg === "none" ? "" : b64encode(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(head + "." + body)), true);
  return head + "." + body + "." + sig;
}

// ---------- a fake Google, a fake KV box, and a record of every call
const calls = [];
const g = {};
function resetGoogle() {
  calls.length = 0;
  Object.assign(g, { counter: 0, failCreateAt: 0, invalidGrant: false, items: [], events: {}, exchange: null });
  g.exchange = { ok: true, data: { access_token: "ACCESS", refresh_token: "REFRESH_SECRET_VALUE", expires_in: 3600, scope: SCOPE } };
}
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  const method = (init.method || "GET").toUpperCase();
  calls.push({ method, url, body: init.body });
  if (url === JWKS_URL) return json({ keys: [publicJwk] });
  if (url === "https://oauth2.googleapis.com/token") {
    const p = new URLSearchParams(init.body);
    if (p.get("grant_type") === "authorization_code") return json(g.exchange.data, g.exchange.ok ? 200 : 400);
    return g.invalidGrant ? json({ error: "invalid_grant" }, 400) : json({ access_token: "ACCESS", expires_in: 3600 });
  }
  if (url === "https://oauth2.googleapis.com/revoke") return json({});
  if (url.startsWith(CAL)) {
    const rest = url.slice(CAL.length);
    if (method === "POST") {
      g.counter++;
      if (g.failCreateAt === g.counter) return json({ error: "boom" }, 500);
      const id = "abcde" + String(g.counter).padStart(3, "0");
      g.events[id] = JSON.parse(init.body);
      return json({ id });
    }
    if (method === "GET" && rest.startsWith("?")) {
      const max = Number(new URLSearchParams(rest.slice(1)).get("maxResults"));
      return json({ items: g.items.slice(0, max) });
    }
    const id = rest.slice(1);
    if (method === "GET") return g.events[id] ? json({ ...g.events[id], status: "confirmed" }) : json({}, 404);
    if (method === "DELETE") {
      delete g.events[id];
      g.items = g.items.filter((item) => item.id !== id);
      return new Response(null, { status: 204 });
    }
  }
  return json({}, 404);
};

const store = new Map();
const kv = {
  async get(key) { return store.has(key) ? JSON.parse(store.get(key)) : null; },
  async put(key, value) { store.set(key, value); },
  async delete(key) { store.delete(key); }
};
const env = {
  FIREBASE_PROJECT_ID: PROJECT,
  GOOGLE_CLIENT_ID: "client-id.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "client-secret",
  MASTER_KEY: MASTER,
  REDIRECT_URI: "https://trackly-calendar.example.workers.dev/google/callback",
  ALLOWED_ORIGINS: SITE + ",https://trackly.ng",
  CALENDAR: kv
};

async function call(method, path, { origin = SITE, token, body, rawBody, e = env } = {}) {
  const headers = {};
  if (origin) headers.Origin = origin;
  if (token) headers.Authorization = "Bearer " + token;
  if (body !== undefined || rawBody !== undefined) headers["Content-Type"] = "application/json";
  const res = await worker.fetch(new Request("https://trackly-calendar.example.workers.dev" + path, {
    method, headers, body: rawBody !== undefined ? rawBody : body !== undefined ? JSON.stringify(body) : undefined, redirect: "manual"
  }), e);
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch (err) { /* not json */ }
  return { status: res.status, data, text, headers: res.headers };
}

function reset() { resetGoogle(); store.clear(); resetCaches(); resetJwksCache(); }
reset();

// ===================== lib: base64, encryption, state =====================
check("base64 round trip", Array.from(b64decode(b64encode(new Uint8Array([0, 1, 250, 255]), true))), [0, 1, 250, 255]);

const sealed = await encryptToken(MASTER, "uid-a", "my-refresh-token");
check("encrypted text does not contain the token", JSON.stringify(sealed).includes("my-refresh-token"), false);
check("decrypts for the same student", await decryptToken(MASTER, "uid-a", sealed), "my-refresh-token");
let blocked = false;
try { await decryptToken(MASTER, "uid-b", sealed); } catch (err) { blocked = true; }
check("another student cannot decrypt it", blocked, true);
blocked = false;
try { await decryptToken(MASTER, "uid-a", { ...sealed, ct: sealed.ct.slice(0, -4) + "AAAA" }); } catch (err) { blocked = true; }
check("a changed value is refused", blocked, true);
blocked = false;
try { await encryptToken(b64encode(new Uint8Array(8)), "uid-a", "x"); } catch (err) { blocked = true; }
check("a short master key is refused", blocked, true);

const state = await signState(MASTER, { uid: "u1", ret: SITE, exp: Date.now() + 60000 });
check("state verifies", (await verifyState(MASTER, state)).uid, "u1");
check("changed state refused", await verifyState(MASTER, "x" + state), null);
check("state with another key refused", await verifyState(b64encode(crypto.getRandomValues(new Uint8Array(32))), state), null);
check("expired state refused", await verifyState(MASTER, await signState(MASTER, { uid: "u1", ret: SITE, exp: Date.now() - 1 })), null);
check("garbage state refused", await verifyState(MASTER, "not-a-state"), null);

// ===================== lib: Firebase sign in token =====================
const ok = { projectId: PROJECT };
check("valid sign in token", await verifyFirebaseToken(await makeToken(), ok), { uid: "student-1" });
check("wrong project (audience)", await verifyFirebaseToken(await makeToken({ aud: "other-app" }), ok), null);
check("wrong issuer", await verifyFirebaseToken(await makeToken({ iss: "https://evil.example/" + PROJECT }), ok), null);
check("expired token", await verifyFirebaseToken(await makeToken({ exp: Math.floor(Date.now() / 1000) - 5 }), ok), null);
check("token from the future", await verifyFirebaseToken(await makeToken({ iat: Math.floor(Date.now() / 1000) + 3600 }), ok), null);
check("no subject", await verifyFirebaseToken(await makeToken({ sub: "" }), ok), null);
check("signed by another key", await verifyFirebaseToken(await makeToken({}, { key: otherPair.privateKey }), ok), null);
check("unknown key id", await verifyFirebaseToken(await makeToken({}, { kid: "nope" }), ok), null);
check("algorithm none", await verifyFirebaseToken(await makeToken({}, { alg: "none" }), ok), null);
check("not a token", await verifyFirebaseToken("abc", ok), null);
check("empty", await verifyFirebaseToken("", ok), null);

// ===================== lib: what the website may ask for =====================
const now = Date.now();
const day = 86400000;
const good = { assignmentId: "abc123", title: "  Chapter 5\nEssay ", courseName: "Biology", timeZone: "Africa/Lagos", due: new Date(now + 5 * day).toISOString(), dueMinutes: [30, 120, 0, 60], daily: { first: new Date(now + day).toISOString(), count: 4 } };
const parsed = parseEventsRequest(good, now);
check("good request", parsed.ok, true);
check("title cleaned", parsed.value.title, "Chapter 5 Essay");
check("minutes sorted biggest first", parsed.value.minutes, [120, 60, 30, 0]);
check("bad assignment id", parseEventsRequest({ ...good, assignmentId: "../x" }, now).error, "bad_assignment");
check("empty title", parseEventsRequest({ ...good, title: "  " }, now).error, "bad_title");
check("bad time zone", parseEventsRequest({ ...good, timeZone: "Mars/Base" }, now).error, "bad_time_zone");
check("due in the past", parseEventsRequest({ ...good, due: new Date(now - 1000).toISOString() }, now).error, "bad_due");
check("due too far away", parseEventsRequest({ ...good, due: new Date(now + 4000 * day).toISOString() }, now).error, "bad_due");
check("minutes not offered", parseEventsRequest({ ...good, dueMinutes: [45] }, now).error, "bad_minutes");
check("six reminders refused", parseEventsRequest({ ...good, dueMinutes: [0, 30, 60, 120, 1440, 2880] }, now).error, "bad_minutes");
check("daily count zero", parseEventsRequest({ ...good, daily: { first: good.daily.first, count: 0 } }, now).error, "bad_daily");
check("daily count too big", parseEventsRequest({ ...good, daily: { first: good.daily.first, count: 400 } }, now).error, "bad_daily");
check("daily after the due time", parseEventsRequest({ ...good, daily: { first: new Date(now + 9 * day).toISOString(), count: 2 } }, now).error, "bad_daily");
check("not an object", parseEventsRequest(null, now).error, "bad_request");

const built = buildEvents(parsed.value, SITE);
check("two events built", built.map((e) => e.kind), ["due", "daily"]);
const dueEv = built[0].body;
check("due event title", dueEv.summary, "Due: Chapter 5 Essay");
check("due event lasts 15 minutes", new Date(dueEv.end.dateTime) - new Date(dueEv.start.dateTime), 15 * 60000);
check("due event popups", dueEv.reminders, { useDefault: false, overrides: [120, 60, 30, 0].map((m) => ({ method: "popup", minutes: m })) });
check("due event is tagged", dueEv.extendedProperties.private, { trackly: "1", assignmentId: "abc123", kind: "due" });
check("link uses the website", dueEv.source.url, SITE + "/assignment.html?id=abc123");
check("description has course and link", dueEv.description.includes("Course: Biology") && dueEv.description.includes(SITE + "/assignment.html?id=abc123"), true);
check("daily repeats with COUNT", built[1].body.recurrence, ["RRULE:FREQ=DAILY;COUNT=4"]);
check("daily rings at the start", built[1].body.reminders.overrides, [{ method: "popup", minutes: 0 }]);
check("daily has the time zone", built[1].body.start.timeZone, "Africa/Lagos");
check("only daily when no due reminders", buildEvents({ ...parsed.value, minutes: [] }, SITE).map((e) => e.kind), ["daily"]);
check("nothing to build", buildEvents({ ...parsed.value, minutes: [], daily: null }, SITE), []);

// ===================== worker: basics =====================
let r = await call("GET", "/", { origin: "" });
check("health check needs no website", [r.status, r.data.service], [200, "trackly-calendar"]);
r = await call("OPTIONS", "/calendar/status");
check("preflight allowed site", [r.status, r.headers.get("Access-Control-Allow-Origin")], [204, SITE]);
r = await call("OPTIONS", "/calendar/status", { origin: "https://evil.example" });
check("preflight other site refused", r.status, 403);
r = await call("GET", "/calendar/status", { e: { ...env, GOOGLE_CLIENT_SECRET: "" } });
check("not configured says so", [r.status, r.data.error], [500, "not_configured"]);
r = await call("POST", "/google/start", { origin: "" });
check("no website, no service", [r.status, r.data.error], [403, "origin_not_allowed"]);
r = await call("POST", "/google/start", { origin: "https://evil.example", token: await makeToken() });
check("other website refused", r.status, 403);
r = await call("GET", "/nothing", { token: await makeToken() });
check("unknown route", [r.status, r.data.error], [404, "not_found"]);
r = await call("GET", "/calendar/status");
check("status needs sign in", [r.status, r.data.error], [401, "sign_in_needed"]);
r = await call("GET", "/calendar/status", { token: await makeToken({}, { key: otherPair.privateKey }) });
check("forged sign in refused", r.status, 401);

// ===================== worker: connecting =====================
const A = await makeToken({ sub: "student-a" });
const B = await makeToken({ sub: "student-b" });

r = await call("POST", "/google/start", { token: A });
const link = new URL(r.data.url);
check("start link goes to Google", link.origin + link.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
check("start link asks for offline access and consent", [link.searchParams.get("access_type"), link.searchParams.get("prompt")], ["offline", "consent"]);
check("start link asks for the narrow scope", link.searchParams.get("scope"), SCOPE);
check("start link redirect and client", [link.searchParams.get("redirect_uri"), link.searchParams.get("client_id")], [env.REDIRECT_URI, env.GOOGLE_CLIENT_ID]);
const startState = await verifyState(MASTER, link.searchParams.get("state"));
check("state carries the student and the website", [startState.uid, startState.ret], ["student-a", SITE]);

r = await call("GET", "/google/callback?code=x&state=nonsense", { origin: "" });
check("bad state refused", r.status, 400);
const expired = await signState(MASTER, { uid: "student-a", ret: SITE, exp: Date.now() - 1000 });
r = await call("GET", "/google/callback?code=x&state=" + expired, { origin: "" });
check("expired state refused", r.status, 400);
const evilState = await signState(MASTER, { uid: "student-a", ret: "https://evil.example", exp: Date.now() + 60000 });
r = await call("GET", "/google/callback?code=x&state=" + evilState, { origin: "" });
check("state pointing at another website refused", r.status, 400);

const goodState = link.searchParams.get("state");
r = await call("GET", "/google/callback?error=access_denied&state=" + goodState, { origin: "" });
check("denied goes back to Profile", [r.status, r.headers.get("Location")], [302, SITE + "/profile.html?calendar=denied"]);
check("denied stores nothing", store.size, 0);

g.exchange = { ok: true, data: { access_token: "a", expires_in: 3600, scope: SCOPE } };
r = await call("GET", "/google/callback?code=c&state=" + goodState, { origin: "" });
check("no refresh token is an error", r.headers.get("Location"), SITE + "/profile.html?calendar=error");
g.exchange = { ok: true, data: { access_token: "a", refresh_token: "R", expires_in: 3600, scope: "openid" } };
r = await call("GET", "/google/callback?code=c&state=" + goodState, { origin: "" });
check("missing permission is an error", r.headers.get("Location"), SITE + "/profile.html?calendar=error");
g.exchange = { ok: false, data: { error: "invalid_grant" } };
r = await call("GET", "/google/callback?code=c&state=" + goodState, { origin: "" });
check("Google refusing the code is an error", r.headers.get("Location"), SITE + "/profile.html?calendar=error");
check("errors store nothing", store.size, 0);

r = await call("GET", "/calendar/status", { token: A });
check("status before connecting", r.data, { status: "disconnected" });

g.exchange = { ok: true, data: { access_token: "ACCESS", refresh_token: "REFRESH_SECRET_VALUE", expires_in: 3600, scope: SCOPE } };
r = await call("GET", "/google/callback?code=c&state=" + goodState, { origin: "" });
check("connected goes back to Profile", [r.status, r.headers.get("Location")], [302, SITE + "/profile.html?calendar=connected"]);
check("one token is stored", Array.from(store.keys()), ["tok:student-a"]);
check("the stored token is encrypted", store.get("tok:student-a").includes("REFRESH_SECRET_VALUE"), false);
const exchangeCall = calls.filter((c) => c.url === "https://oauth2.googleapis.com/token").pop();
check("code exchange sent the secret to Google only", new URLSearchParams(exchangeCall.body).get("client_secret"), "client-secret");

r = await call("GET", "/calendar/status", { token: A });
check("status after connecting", [r.data.status, typeof r.data.connectedAt], ["connected", "string"]);
r = await call("GET", "/calendar/status", { token: B });
check("another student is not connected", r.data, { status: "disconnected" });

// ===================== worker: creating events =====================
const body = { ...good, due: new Date(Date.now() + 5 * day).toISOString(), daily: { first: new Date(Date.now() + day).toISOString(), count: 4 } };
calls.length = 0;
r = await call("POST", "/calendar/events", { token: A, body });
check("events created", [r.status, r.data.events], [200, [{ kind: "due", id: "abcde001" }, { kind: "daily", id: "abcde002" }]]);
check("Google got the tagged event", g.events.abcde001.extendedProperties.private.trackly, "1");
check("Google calls used the student's token", calls.filter((c) => c.url.startsWith(CAL)).length, 2);

r = await call("POST", "/calendar/events", { token: B, body });
check("not connected cannot create", [r.status, r.data.error], [409, "not_connected"]);
r = await call("POST", "/calendar/events", { token: A, body: { ...body, due: "yesterday" } });
check("bad request refused", [r.status, r.data.error], [400, "bad_due"]);
r = await call("POST", "/calendar/events", { token: A, rawBody: "{nope" });
check("broken json refused", [r.status, r.data.error], [400, "bad_request"]);
r = await call("POST", "/calendar/events", { token: A, rawBody: JSON.stringify({ pad: "x".repeat(5000) }) });
check("too big refused", [r.status, r.data.error], [413, "too_big"]);

g.counter = 0; g.events = {}; g.failCreateAt = 2; calls.length = 0;
r = await call("POST", "/calendar/events", { token: A, body });
check("second event failing gives an error", [r.status, r.data.error], [502, "google"]);
check("the first event is taken back", calls.some((c) => c.method === "DELETE" && c.url === CAL + "/abcde001"), true);
check("no event is left behind", Object.keys(g.events), []);
g.failCreateAt = 0;

// ===================== worker: deleting events =====================
g.events = { abcde010: { extendedProperties: { private: { trackly: "1" } } }, abcde011: { summary: "My dentist" } };
calls.length = 0;
r = await call("POST", "/calendar/delete", { token: A, body: { eventIds: ["abcde010", "abcde011", "abcde012"] } });
check("delete counts ours and the already gone", [r.status, r.data.deleted, r.data.requested], [200, 2, 3]);
check("our event is deleted", "abcde010" in g.events, false);
check("an event Trackly did not make is never touched", "abcde011" in g.events, true);
check("no delete call for it", calls.some((c) => c.method === "DELETE" && c.url.endsWith("abcde011")), false);
r = await call("POST", "/calendar/delete", { token: A, body: { eventIds: ["../etc"] } });
check("bad event id refused", r.data.error, "bad_request");
r = await call("POST", "/calendar/delete", { token: A, body: { eventIds: Array.from({ length: 11 }, (_, i) => "abcde0" + (10 + i)) } });
check("more than ten refused", r.data.error, "bad_request");
r = await call("POST", "/calendar/delete", { token: A, body: {} });
check("nothing to delete refused", r.data.error, "bad_request");

// ===================== worker: disconnecting =====================
g.items = [{ id: "abcde020" }, { id: "abcde021" }, { id: "abcde022" }];
g.events = { abcde020: {}, abcde021: {}, abcde022: {} };
calls.length = 0;
r = await call("POST", "/calendar/disconnect", { token: A });
check("disconnect removes every Trackly event", [r.data.done, r.data.removed, g.items.length], [true, 3, 0]);
check("access is revoked at Google", calls.some((c) => c.url === "https://oauth2.googleapis.com/revoke"), true);
check("the token is forgotten", store.has("tok:student-a"), false);
r = await call("GET", "/calendar/status", { token: A });
check("status after disconnecting", r.data, { status: "disconnected" });
r = await call("POST", "/calendar/disconnect", { token: A });
check("disconnecting twice is fine", r.data, { done: true, removed: 0 });

// connect again, then a big clean up that needs more than one call
g.exchange = { ok: true, data: { access_token: "ACCESS", refresh_token: "REFRESH_SECRET_VALUE", expires_in: 3600, scope: SCOPE } };
await call("GET", "/google/callback?code=c&state=" + (await signState(MASTER, { uid: "student-a", ret: SITE, exp: Date.now() + 60000 })), { origin: "" });
g.items = Array.from({ length: 100 }, (_, i) => ({ id: "abcde" + String(100 + i) }));
calls.length = 0;
r = await call("POST", "/calendar/disconnect", { token: A });
check("a big clean up stops part way", [r.data.done, r.data.removed > 0, r.data.removed < 100], [false, true, true]);
check("outside calls stay under the free limit", calls.filter((c) => c.url.startsWith(CAL)).length <= 40, true);
check("not revoked until finished", [calls.some((c) => c.url.endsWith("/revoke")), store.has("tok:student-a")], [false, true]);
for (let i = 0; i < 6 && !r.data.done; i++) r = await call("POST", "/calendar/disconnect", { token: A });
check("calling again finishes it", [r.data.done, g.items.length, store.has("tok:student-a")], [true, 0, false]);

// ===================== worker: Google took the permission away =====================
g.exchange = { ok: true, data: { access_token: "ACCESS", refresh_token: "REFRESH_SECRET_VALUE", expires_in: 3600, scope: SCOPE } };
await call("GET", "/google/callback?code=c&state=" + (await signState(MASTER, { uid: "student-a", ret: SITE, exp: Date.now() + 60000 })), { origin: "" });
resetCaches();
g.invalidGrant = true;
r = await call("GET", "/calendar/status", { token: A });
check("expired permission says reconnect", r.data, { status: "reconnect" });
check("the dead token is forgotten", store.has("tok:student-a"), false);
g.invalidGrant = false;

// ===================== the real allowed list in wrangler.toml =====================
const { readFileSync } = await import("node:fs");
const toml = readFileSync(new URL("../worker-calendar/wrangler.toml", import.meta.url), "utf8");
const listed = /ALLOWED_ORIGINS\s*=\s*"([^"]+)"/.exec(toml)[1].split(",").map((s) => s.trim());
for (const origin of ["http://localhost:5000", "http://127.0.0.1:5000", "http://localhost:5500", "http://127.0.0.1:5500", "https://trackly-e18d8.web.app", "https://trackly-e18d8.firebaseapp.com", "https://trackly.ng", "https://www.trackly.ng"]) {
  check("wrangler.toml lists " + origin, listed.includes(origin), true);
  const pre = await call("OPTIONS", "/calendar/status", { origin, e: { ...env, ALLOWED_ORIGINS: listed.join(",") } });
  check("preflight works from " + origin, [pre.status, pre.headers.get("Access-Control-Allow-Origin")], [204, origin]);
}
check("a port that is not listed is refused", (await call("OPTIONS", "/calendar/status", { origin: "http://localhost:3000", e: { ...env, ALLOWED_ORIGINS: listed.join(",") } })).status, 403);

console.log(failed ? failed + " FAILED" : "ALL PASSED");
process.exit(failed ? 1 : 0);
