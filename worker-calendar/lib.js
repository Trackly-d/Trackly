/* ==========================================================
   TRACKLY calendar worker: shared logic
   Pure functions that need no Cloudflare, so tests/worker-calendar.test.mjs can run them in Node.
     - base64 helpers
     - encrypting the long lived Google token (AES-GCM, key made from MASTER_KEY)
     - signing the "state" that travels through Google (HMAC), so nothing is kept in the browser
     - checking a Firebase sign in token (the student's proof of who they are)
     - checking what the website asks for, and building the Google Calendar events
   Google tokens are never written to Firestore and never sent to the browser.
   ========================================================== */

const enc = new TextEncoder();
const dec = new TextDecoder();

/* ---------- base64 ---------- */
export function b64decode(text) {
  const clean = String(text).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(clean + "=".repeat((4 - (clean.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export function b64encode(bytes, url = false) {
  let bin = "";
  new Uint8Array(bytes).forEach((b) => { bin += String.fromCharCode(b); });
  const out = btoa(bin);
  return url ? out.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") : out;
}

/* ---------- keys made from the one MASTER_KEY secret ---------- */
async function derive(masterB64, label) {
  let master;
  try { master = b64decode(masterB64); } catch (err) { throw new Error("MASTER_KEY is not valid base64"); }
  if (master.length < 32) throw new Error("MASTER_KEY must be at least 32 bytes");
  const key = await crypto.subtle.importKey("raw", master, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(label)));
}

/* ---------- encrypting the Google token ---------- */
export async function encryptToken(masterB64, uid, plaintext) {
  const key = await crypto.subtle.importKey("raw", await derive(masterB64, "trackly-token-encryption"), "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(uid) }, key, enc.encode(plaintext));
  return { v: 1, iv: b64encode(iv), ct: b64encode(ct) };
}

/* Throws if the stored value was changed or belongs to another student */
export async function decryptToken(masterB64, uid, record) {
  const key = await crypto.subtle.importKey("raw", await derive(masterB64, "trackly-token-encryption"), "AES-GCM", false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: b64decode(record.iv), additionalData: enc.encode(uid) }, key, b64decode(record.ct));
  return dec.decode(plain);
}

/* ---------- the signed "state" (who started the connect, where to return, until when) ---------- */
export async function signState(masterB64, payload) {
  const body = b64encode(enc.encode(JSON.stringify(payload)), true);
  const key = await crypto.subtle.importKey("raw", await derive(masterB64, "trackly-state-signing"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  return body + "." + b64encode(sig, true);
}

/* Returns the payload, or null if it was changed, is malformed, or has expired */
export async function verifyState(masterB64, text, now = Date.now()) {
  const parts = String(text || "").split(".");
  if (parts.length !== 2) return null;
  try {
    const key = await crypto.subtle.importKey("raw", await derive(masterB64, "trackly-state-signing"), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    const ok = await crypto.subtle.verify("HMAC", key, b64decode(parts[1]), enc.encode(parts[0]));
    if (!ok) return null;
    const payload = JSON.parse(dec.decode(b64decode(parts[0])));
    if (!payload || typeof payload.exp !== "number" || payload.exp < now) return null;
    return payload;
  } catch (err) {
    return null;
  }
}

/* ---------- Firebase sign in token ---------- */
const JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
let jwks = { keys: [], at: 0 };

export function resetJwksCache() { jwks = { keys: [], at: 0 }; }

async function loadKeys(fetchFn, now) {
  if (jwks.keys.length && now - jwks.at < 3600 * 1000) return jwks.keys;
  const res = await fetchFn(JWKS_URL);
  if (!res.ok) throw new Error("Could not load Firebase keys");
  const data = await res.json();
  jwks = { keys: data.keys || [], at: now };
  return jwks.keys;
}

/* Returns { uid } for a valid, current token for THIS Firebase project, otherwise null.
   Checks: algorithm, signature (Google's public key for the token's kid), audience (the project ID),
   issuer, expiry, issue time, and a subject. */
export async function verifyFirebaseToken(token, { projectId, fetchFn = fetch, now = Date.now() }) {
  try {
    const parts = String(token || "").split(".");
    if (parts.length !== 3) return null;
    const header = JSON.parse(dec.decode(b64decode(parts[0])));
    if (header.alg !== "RS256" || typeof header.kid !== "string") return null;

    let keys = await loadKeys(fetchFn, now);
    let jwk = keys.find((k) => k.kid === header.kid);
    if (!jwk) { resetJwksCache(); keys = await loadKeys(fetchFn, now); jwk = keys.find((k) => k.kid === header.kid); }
    if (!jwk) return null;

    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64decode(parts[2]), enc.encode(parts[0] + "." + parts[1]));
    if (!valid) return null;

    const p = JSON.parse(dec.decode(b64decode(parts[1])));
    const sec = Math.floor(now / 1000);
    if (p.aud !== projectId || p.iss !== "https://securetoken.google.com/" + projectId) return null;
    if (typeof p.exp !== "number" || p.exp <= sec) return null;
    if (typeof p.iat !== "number" || p.iat > sec + 300) return null;
    if (typeof p.sub !== "string" || !p.sub) return null;
    return { uid: p.sub };
  } catch (err) {
    return null;
  }
}

/* ---------- websites allowed to use this Worker ---------- */
export function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || "").split(",").map((o) => o.trim()).filter(Boolean);
}

/* ---------- what the website may ask for ---------- */
export const REMINDER_MINUTES = [0, 30, 60, 120, 1440, 2880];
export const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
export const EVENT_ID_PATTERN = /^[a-v0-9]{5,1024}$/;
const EVENT_MINUTES = 15;

function cleanText(value, max) {
  return String(value == null ? "" : value).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function validZone(zone) {
  try { new Intl.DateTimeFormat("en-US", { timeZone: zone }); return typeof zone === "string" && zone.length < 60; } catch (err) { return false; }
}

/* Checks the body of POST /calendar/events. Returns { ok, value } or { ok: false, error } */
export function parseEventsRequest(body, now = Date.now()) {
  const fail = (error) => ({ ok: false, error });
  if (!body || typeof body !== "object") return fail("bad_request");
  if (!ID_PATTERN.test(body.assignmentId || "")) return fail("bad_assignment");

  const title = cleanText(body.title, 120);
  if (title.length < 1) return fail("bad_title");
  if (!validZone(body.timeZone)) return fail("bad_time_zone");

  const due = new Date(body.due);
  if (Number.isNaN(due.getTime()) || due.getTime() <= now || due.getTime() > now + 3 * 365 * 86400000) return fail("bad_due");

  let minutes = [];
  if (body.dueMinutes != null) {
    if (!Array.isArray(body.dueMinutes) || body.dueMinutes.length > 5) return fail("bad_minutes");
    minutes = Array.from(new Set(body.dueMinutes.map(Number)));
    if (minutes.some((m) => !REMINDER_MINUTES.includes(m))) return fail("bad_minutes");
    minutes.sort((a, b) => b - a);
  }

  let daily = null;
  if (body.daily != null) {
    const first = new Date(body.daily.first);
    const count = Number(body.daily.count);
    if (Number.isNaN(first.getTime()) || first.getTime() < now - 60000 || first.getTime() > due.getTime()) return fail("bad_daily");
    if (!Number.isInteger(count) || count < 1 || count > 366) return fail("bad_daily");
    daily = { first, count };
  }

  return {
    ok: true,
    value: { assignmentId: body.assignmentId, title, courseName: cleanText(body.courseName, 80), timeZone: body.timeZone, due, minutes, daily }
  };
}

/* ---------- the Google Calendar events ---------- */
function describe(courseName, link) {
  return (courseName ? "Course: " + courseName + "\n" : "") + "Open in Trackly: " + link + "\n\nAdded by Trackly";
}

function base(kind, req, link, summary, start, overrides) {
  const end = new Date(start.getTime() + EVENT_MINUTES * 60000);
  return {
    summary,
    description: describe(req.courseName, link),
    source: { title: "Trackly", url: link },
    start: { dateTime: start.toISOString(), timeZone: req.timeZone },
    end: { dateTime: end.toISOString(), timeZone: req.timeZone },
    reminders: { useDefault: false, overrides: overrides.map((m) => ({ method: "popup", minutes: m })) },
    extendedProperties: { private: { trackly: "1", assignmentId: req.assignmentId, kind } }
  };
}

/* Up to two events: the due event (popup reminders around the due time) and the daily 8:00 AM series */
export function buildEvents(req, origin) {
  const link = origin + "/assignment.html?id=" + encodeURIComponent(req.assignmentId);
  const events = [];
  if (req.minutes.length) {
    events.push({ kind: "due", body: base("due", req, link, "Due: " + req.title, req.due, req.minutes) });
  }
  if (req.daily) {
    const body = base("daily", req, link, "Work on: " + req.title, req.daily.first, [0]);
    body.recurrence = ["RRULE:FREQ=DAILY;COUNT=" + req.daily.count];
    events.push({ kind: "daily", body });
  }
  return events;
}