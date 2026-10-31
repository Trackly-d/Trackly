/* ==========================================================
   TRACKLY push worker
   Sends push notifications to a student's phones and computers, even when Trackly is closed.

   Two jobs:
     1. EVENTS: the website says "something happened" (an assignment was added, submitted, edited...). The Worker pushes it
        to ALL the student's devices, including the one that did it.
     2. TIMED ALERTS: the website tells the Worker which assignments are open. Every minute (a cron trigger) the Worker sends the
        "due soon" and "overdue" pushes whose time has come. Times come from js/push-logic.js, the same rules as the in-app alerts.

   Every request proves who the student is with their Firebase sign in token (same as the calendar Worker).
   The Worker keeps push addresses, the student's push choices and, for open assignments, the title and due time.
   It is all deleted with the account (POST /push/delete-all).

   Routes (called by our website only):
     POST /push/subscribe     remember this device       { subscription }
     POST /push/unsubscribe   forget this device         { endpoint }
     POST /push/prefs         { alertsEnabled, alertHours, types }
     POST /push/watch         { items: [{ assignmentId, title, courseName, dueAt, createdAt, status }] } (status "closed" forgets it)
     POST /push/event         { kind, id, title, courseName }
     POST /push/delete-all    forget everything about this student

   Needs (see README.md):  D1 binding DB, secret VAPID_PRIVATE_JWK, settings FIREBASE_PROJECT_ID, VAPID_PUBLIC_KEY, VAPID_SUBJECT, ALLOWED_ORIGINS
   ========================================================== */

import { allowedOrigins, verifyFirebaseToken, ID_PATTERN } from "../worker-calendar/lib.js";
import { normalizeTypes, normalizeHours, nextAlarm, pushText, EVENT_KINDS, GRACE_MS, DEFAULT_ALERT_HOURS } from "../js/push-logic.js";
import { parseSubscription, validEndpoint, endpointHash, importVapid, sendPush } from "./lib.js";

const MAX_BODY = 16384;
const MAX_ITEMS = 25;
const MAX_DEVICES = 8;            // per student
const MAX_EVENT_DEVICES = 5;      // pushes per event (free Workers have a small CPU limit per request)
const MAX_PUSHES_PER_TICK = 8;    // same reason: more are sent on the next minute
const DUE_ROWS_PER_TICK = 8;
const DIRTY_ROWS_PER_TICK = 8;    // the free plan allows about 50 database queries per run, this stays under it

class HttpError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}

let vapidCache = null;
export function resetCaches() { vapidCache = null; }

async function vapidFor(env) {
  if (!vapidCache) vapidCache = await importVapid(env.VAPID_PRIVATE_JWK);
  return vapidCache;
}

function reply(data, status, cors) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...cors }
  });
}

function needConfig(env) {
  if (!(env.FIREBASE_PROJECT_ID && env.DB && env.VAPID_PRIVATE_JWK && env.VAPID_PUBLIC_KEY && env.VAPID_SUBJECT)) throw new HttpError(500, "not_configured");
}

async function requireUser(request, env) {
  const header = request.headers.get("Authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const user = await verifyFirebaseToken(token, { projectId: env.FIREBASE_PROJECT_ID });
  if (!user) throw new HttpError(401, "sign_in_needed");
  return user;
}

async function readJson(request) {
  const text = await request.text();
  if (text.length > MAX_BODY) throw new HttpError(413, "too_big");
  try { return JSON.parse(text); } catch (err) { throw new HttpError(400, "bad_request"); }
}

function cleanText(value, max) {
  return String(value == null ? "" : value).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

/* ---------- The student's push choices ---------- */
async function loadPrefs(env, uid) {
  const row = await env.DB.prepare("SELECT enabled, hours, types FROM prefs WHERE uid = ?").bind(uid).first();
  if (!row) return { enabled: true, hours: DEFAULT_ALERT_HOURS.slice(), types: normalizeTypes({}) };
  let hours; let types;
  try { hours = JSON.parse(row.hours); } catch (err) { hours = null; }
  try { types = JSON.parse(row.types); } catch (err) { types = null; }
  return { enabled: row.enabled === 1, hours: normalizeHours(hours), types: normalizeTypes(types) };
}

const countDevices = async (env, uid) => (await env.DB.prepare("SELECT COUNT(*) AS n FROM device WHERE uid = ?").bind(uid).first()).n;

/* ---------- Routes ---------- */
async function subscribe(request, env, cors, user) {
  const body = await readJson(request);
  const parsed = parseSubscription(body.subscription);
  if (!parsed.ok) throw new HttpError(400, "bad_subscription");
  const s = parsed.value;
  const hash = await endpointHash(s.endpoint);
  // One push address belongs to one student: if someone else signs in on the same browser, it moves to them
  await env.DB.prepare(
    "INSERT INTO device (endpoint_hash, uid, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?, ?) " +
    "ON CONFLICT(endpoint_hash) DO UPDATE SET uid = excluded.uid, endpoint = excluded.endpoint, p256dh = excluded.p256dh, auth = excluded.auth, created_at = excluded.created_at"
  ).bind(hash, user.uid, s.endpoint, s.p256dh, s.auth, Date.now()).run();
  await env.DB.prepare(
    "DELETE FROM device WHERE uid = ?1 AND endpoint_hash NOT IN (SELECT endpoint_hash FROM device WHERE uid = ?1 ORDER BY created_at DESC LIMIT ?2)"
  ).bind(user.uid, MAX_DEVICES).run();
  return reply({ devices: await countDevices(env, user.uid) }, 200, cors);
}

async function unsubscribe(request, env, cors, user) {
  const body = await readJson(request);
  if (!validEndpoint(body.endpoint)) throw new HttpError(400, "bad_subscription");
  await env.DB.prepare("DELETE FROM device WHERE endpoint_hash = ? AND uid = ?").bind(await endpointHash(body.endpoint), user.uid).run();
  return reply({ devices: await countDevices(env, user.uid) }, 200, cors);
}

async function savePrefs(request, env, cors, user) {
  const body = await readJson(request);
  if (typeof body.alertsEnabled !== "boolean" || !Array.isArray(body.alertHours)) throw new HttpError(400, "bad_prefs");
  const hours = normalizeHours(body.alertHours);
  const types = normalizeTypes(body.types);
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO prefs (uid, enabled, hours, types, updated_at) VALUES (?, ?, ?, ?, ?) " +
      "ON CONFLICT(uid) DO UPDATE SET enabled = excluded.enabled, hours = excluded.hours, types = excluded.types, updated_at = excluded.updated_at"
    ).bind(user.uid, body.alertsEnabled ? 1 : 0, JSON.stringify(hours), JSON.stringify(types), Date.now()),
    // the times depend on these choices, so every waiting assignment is worked out again (a few per minute)
    env.DB.prepare("UPDATE watch SET state = 0, next_at = NULL, next_kind = NULL, next_hours = NULL WHERE uid = ?").bind(user.uid)
  ]);
  return reply({ ok: true }, 200, cors);
}

async function watch(request, env, cors, user, now) {
  const body = await readJson(request);
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > MAX_ITEMS) throw new HttpError(400, "bad_items");
  const statements = [];
  for (const item of body.items) {
    if (!item || !ID_PATTERN.test(item.assignmentId || "")) throw new HttpError(400, "bad_assignment");
    const remove = () => statements.push(env.DB.prepare("DELETE FROM watch WHERE uid = ? AND aid = ?").bind(user.uid, item.assignmentId));
    if (item.status !== "open") { remove(); continue; }
    const due = new Date(item.dueAt).getTime();
    const created = new Date(item.createdAt).getTime();
    const title = cleanText(item.title, 120);
    if (!title || Number.isNaN(due) || Number.isNaN(created)) throw new HttpError(400, "bad_item");
    if (due <= now || due > now + 3 * 365 * 86400000) { remove(); continue; } // nothing left to send
    statements.push(env.DB.prepare(
      "INSERT INTO watch (uid, aid, title, course, due_ms, created_ms, state) VALUES (?, ?, ?, ?, ?, ?, 0) " +
      "ON CONFLICT(uid, aid) DO UPDATE SET title = excluded.title, course = excluded.course, due_ms = excluded.due_ms, created_ms = excluded.created_ms, state = 0, next_at = NULL, next_kind = NULL, next_hours = NULL"
    ).bind(user.uid, item.assignmentId, title, cleanText(item.courseName, 80), due, created));
  }
  await env.DB.batch(statements);
  return reply({ ok: true, count: statements.length }, 200, cors);
}

async function event(request, env, cors, user) {
  const body = await readJson(request);
  if (!EVENT_KINDS.includes(body.kind)) throw new HttpError(400, "bad_kind");
  if (!ID_PATTERN.test(body.id || "")) throw new HttpError(400, "bad_id");
  const prefs = await loadPrefs(env, user.uid);
  if (!prefs.types[body.kind]) return reply({ sent: 0 }, 200, cors);

  const message = pushText(body.kind, { id: body.id, name: cleanText(body.title, 120), courseName: cleanText(body.courseName, 80) });
  const devices = (await env.DB.prepare("SELECT endpoint_hash, endpoint, p256dh, auth FROM device WHERE uid = ?").bind(user.uid).all()).results
    .slice(0, MAX_EVENT_DEVICES);

  const vapid = await vapidFor(env);
  const gone = [];
  let sent = 0;
  for (const d of devices) {
    const res = await sendPush(d, { t: message.title, b: message.body, u: message.url, g: message.tag }, { vapid, subject: env.VAPID_SUBJECT });
    if (res.ok) sent++;
    else if (res.gone) gone.push(d.endpoint_hash);
  }
  if (gone.length) await env.DB.batch(gone.map((h) => env.DB.prepare("DELETE FROM device WHERE endpoint_hash = ?").bind(h)));
  return reply({ sent }, 200, cors);
}

async function deleteAll(env, cors, user) {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM device WHERE uid = ?").bind(user.uid),
    env.DB.prepare("DELETE FROM watch WHERE uid = ?").bind(user.uid),
    env.DB.prepare("DELETE FROM prefs WHERE uid = ?").bind(user.uid)
  ]);
  return reply({ ok: true }, 200, cors);
}

/* ---------- The every minute job ---------- */
export async function runSchedule(env, now = Date.now(), fetchFn = fetch) {
  const prefsSeen = new Map();
  const prefsFor = async (uid) => {
    if (!prefsSeen.has(uid)) prefsSeen.set(uid, await loadPrefs(env, uid));
    return prefsSeen.get(uid);
  };
  const armed = (r, n) => env.DB.prepare(n
    ? "UPDATE watch SET state = 1, next_at = ?, next_kind = ?, next_hours = ? WHERE uid = ? AND aid = ?"
    : "UPDATE watch SET state = 2, next_at = NULL, next_kind = NULL, next_hours = NULL WHERE uid = ? AND aid = ?"
  ).bind(...(n ? [n.at, n.kind, n.hours, r.uid, r.aid] : [r.uid, r.aid]));

  // 1. Work out the next push for assignments that were just added, edited, or whose choices changed
  const dirty = (await env.DB.prepare("SELECT uid, aid, due_ms, created_ms FROM watch WHERE state = 0 LIMIT ?").bind(DIRTY_ROWS_PER_TICK).all()).results;
  if (dirty.length) {
    const updates = [];
    for (const r of dirty) {
      const p = await prefsFor(r.uid);
      updates.push(armed(r, nextAlarm({ dueMs: r.due_ms, createdMs: r.created_ms, hours: p.hours, enabled: p.enabled, after: now })));
    }
    await env.DB.batch(updates);
  }

  // 2. Send the pushes whose time has come
  const due = (await env.DB.prepare("SELECT * FROM watch WHERE state = 1 AND next_at <= ? ORDER BY next_at LIMIT ?").bind(now, DUE_ROWS_PER_TICK).all()).results;
  const vapid = due.length ? await vapidFor(env) : null;
  const updates = [];
  const gone = [];
  let sent = 0;
  for (const r of due) {
    const p = await prefsFor(r.uid);
    const late = now - r.next_at > GRACE_MS;
    if (!late && p.enabled && p.types[r.next_kind]) {
      const devices = (await env.DB.prepare("SELECT endpoint_hash, endpoint, p256dh, auth FROM device WHERE uid = ?").bind(r.uid).all()).results;
      if (sent > 0 && sent + devices.length > MAX_PUSHES_PER_TICK) break; // the rest go out next minute
      const m = pushText(r.next_kind, { id: r.aid, name: r.title, courseName: r.course, hours: r.next_hours });
      for (const d of devices) {
        const res = await sendPush(d, { t: m.title, b: m.body, u: m.url, g: m.tag }, { vapid, subject: env.VAPID_SUBJECT, fetchFn, now });
        sent++;
        if (res.gone) gone.push(d.endpoint_hash);
      }
    }
    updates.push(armed(r, nextAlarm({ dueMs: r.due_ms, createdMs: r.created_ms, hours: p.hours, enabled: p.enabled, after: r.next_at })));
  }
  for (const h of new Set(gone)) updates.push(env.DB.prepare("DELETE FROM device WHERE endpoint_hash = ?").bind(h));
  if (updates.length) await env.DB.batch(updates);

  // 3. Nothing left to send for these: forget them
  await env.DB.prepare("DELETE FROM watch WHERE state = 2").run();
  return { sent, checked: due.length, worked: dirty.length };
}

/* ---------- Entry point ---------- */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const originOk = Boolean(origin) && allowedOrigins(env).includes(origin);
    const cors = originOk ? { "Access-Control-Allow-Origin": origin, "Vary": "Origin" } : {};

    try {
      if (request.method === "OPTIONS") {
        if (!originOk) return new Response("Not allowed", { status: 403 });
        return new Response(null, {
          status: 204,
          headers: { ...cors, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Max-Age": "86400" }
        });
      }
      if (request.method === "GET" && url.pathname === "/") return reply({ ok: true, service: "trackly-push" }, 200, cors);

      needConfig(env);
      if (!originOk) throw new HttpError(403, "origin_not_allowed");
      if (request.method !== "POST") throw new HttpError(404, "not_found");

      const user = await requireUser(request, env);
      switch (url.pathname) {
        case "/push/subscribe": return await subscribe(request, env, cors, user);
        case "/push/unsubscribe": return await unsubscribe(request, env, cors, user);
        case "/push/prefs": return await savePrefs(request, env, cors, user);
        case "/push/watch": return await watch(request, env, cors, user, Date.now());
        case "/push/event": return await event(request, env, cors, user);
        case "/push/delete-all": return await deleteAll(env, cors, user);
        default: throw new HttpError(404, "not_found");
      }
    } catch (err) {
      if (err instanceof HttpError) return reply({ error: err.code }, err.status, cors);
      console.error("push worker error:", err && err.name, err && err.message); // never log keys or push addresses
      return reply({ error: "server" }, 500, cors);
    }
  },

  async scheduled(controller, env, ctx) {
    try {
      needConfig(env);
      ctx.waitUntil(runSchedule(env).catch((err) => console.error("push cron error:", err && err.name, err && err.message)));
    } catch (err) {
      console.error("push cron error:", err && err.name, err && err.message);
    }
  }
};
