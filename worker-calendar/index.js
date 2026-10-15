/* ==========================================================
   TRACKLY calendar worker
   Adds and removes the student's Trackly reminders in their Google Calendar.

   The browser never sees a Google token. The Worker keeps the long lived token ENCRYPTED in KV,
   and every request proves who the student is with their Firebase sign in token.

   Routes (all called by our website only, except the callback which Google calls):
     POST /google/start       gives the website the Google permission link
     GET  /google/callback    Google sends the student back here, we store the token, then go to Profile
     GET  /calendar/status    "connected", "disconnected" or "reconnect"
     POST /calendar/events    creates the due event and the daily 8:00 AM series for one assignment
     POST /calendar/delete    removes events by id (only ones Trackly made)
     POST /calendar/disconnect  removes every Trackly event (in batches), revokes Google access, forgets the token

   Needs (see README.md):
     KV binding           CALENDAR
     Secrets              GOOGLE_CLIENT_SECRET, MASTER_KEY
     Settings (vars)      FIREBASE_PROJECT_ID, GOOGLE_CLIENT_ID, REDIRECT_URI, ALLOWED_ORIGINS
   ========================================================== */

import {
  allowedOrigins, verifyFirebaseToken, encryptToken, decryptToken, signState, verifyState,
  parseEventsRequest, buildEvents, EVENT_ID_PATTERN
} from "./lib.js";

const SCOPE = "https://www.googleapis.com/auth/calendar.events.owned";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const CAL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const STATE_MINUTES = 10;
const MAX_BODY = 4096;
const DISCONNECT_BUDGET = 40; // free Workers allow about 50 outside calls per request, so big clean ups run in batches

class HttpError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}

/* Short lived Google access tokens, remembered only while this Worker instance is awake */
const tokenCache = new Map();
export function resetCaches() { tokenCache.clear(); }

function reply(data, status, cors) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...cors }
  });
}

function needConfig(env) {
  const ok = env.FIREBASE_PROJECT_ID && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.MASTER_KEY && env.REDIRECT_URI && env.CALENDAR;
  if (!ok) throw new HttpError(500, "not_configured");
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

/* ---------- Google tokens ---------- */
async function tokenRequest(params) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params)
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

async function accessTokenFor(env, uid) {
  const hit = tokenCache.get(uid);
  if (hit && hit.exp > Date.now() + 60000) return hit.token;

  const stored = await env.CALENDAR.get("tok:" + uid, "json");
  if (!stored) throw new HttpError(409, "not_connected");

  const refresh = await decryptToken(env.MASTER_KEY, uid, stored);
  const { res, data } = await tokenRequest({
    client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
    refresh_token: refresh, grant_type: "refresh_token"
  });
  if (!res.ok) {
    if (data.error === "invalid_grant") { // the student removed access, or Google expired it
      await env.CALENDAR.delete("tok:" + uid);
      tokenCache.delete(uid);
      throw new HttpError(409, "reconnect");
    }
    throw new HttpError(502, "google");
  }
  tokenCache.set(uid, { token: data.access_token, exp: Date.now() + (Number(data.expires_in) || 3000) * 1000 });
  return data.access_token;
}

/* One call to the Google Calendar API, with one retry if the remembered token had just expired */
async function gcal(env, uid, method, url, body, retry = true) {
  const token = await accessTokenFor(env, uid);
  const headers = { Authorization: "Bearer " + token };
  if (body) headers["Content-Type"] = "application/json";
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 401 && retry) { tokenCache.delete(uid); return gcal(env, uid, method, url, body, false); }
  if (res.status === 401) throw new HttpError(409, "reconnect");
  return res;
}

const isGone = (res) => res.status === 404 || res.status === 410;

/* ---------- Routes ---------- */
async function start(request, env, cors, origin) {
  const user = await requireUser(request, env);
  const state = await signState(env.MASTER_KEY, {
    uid: user.uid, ret: origin, exp: Date.now() + STATE_MINUTES * 60000, n: crypto.randomUUID()
  });
  const url = AUTH_URL + "?" + new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID, redirect_uri: env.REDIRECT_URI, response_type: "code",
    scope: SCOPE, access_type: "offline", prompt: "consent", state
  });
  return reply({ url }, 200, cors);
}

async function callback(url, env) {
  const state = await verifyState(env.MASTER_KEY, url.searchParams.get("state"));
  if (!state || !allowedOrigins(env).includes(state.ret)) {
    return new Response("This link is not valid or has expired. Go back to Trackly and press Connect again.", { status: 400 });
  }
  const back = (flag) => Response.redirect(state.ret + "/profile.html?calendar=" + flag, 302);

  const code = url.searchParams.get("code");
  if (url.searchParams.get("error") || !code) return back("denied");

  const { res, data } = await tokenRequest({
    code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
    redirect_uri: env.REDIRECT_URI, grant_type: "authorization_code"
  });
  const granted = String(data.scope || "").split(" ").includes(SCOPE);
  if (!res.ok || !data.refresh_token || !granted) return back("error");

  const record = { ...(await encryptToken(env.MASTER_KEY, state.uid, data.refresh_token)), at: new Date().toISOString() };
  await env.CALENDAR.put("tok:" + state.uid, JSON.stringify(record));
  tokenCache.delete(state.uid);
  return back("connected");
}

async function status(request, env, cors) {
  const user = await requireUser(request, env);
  try {
    await accessTokenFor(env, user.uid);
  } catch (err) {
    if (err instanceof HttpError && err.code === "not_connected") return reply({ status: "disconnected" }, 200, cors);
    if (err instanceof HttpError && err.code === "reconnect") return reply({ status: "reconnect" }, 200, cors);
    throw err;
  }
  const stored = await env.CALENDAR.get("tok:" + user.uid, "json");
  return reply({ status: "connected", connectedAt: (stored && stored.at) || null }, 200, cors);
}

async function createEvents(request, env, cors, origin) {
  const user = await requireUser(request, env);
  const parsed = parseEventsRequest(await readJson(request));
  if (!parsed.ok) throw new HttpError(400, parsed.error);

  const made = [];
  try {
    for (const event of buildEvents(parsed.value, origin)) {
      const res = await gcal(env, user.uid, "POST", CAL, event.body);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.id) throw new HttpError(502, "google");
      made.push({ kind: event.kind, id: data.id });
    }
  } catch (err) {
    // All or nothing: take back the first event if the second one failed
    for (const m of made) await gcal(env, user.uid, "DELETE", CAL + "/" + m.id).catch(() => {});
    throw err;
  }
  return reply({ events: made }, 200, cors);
}

async function deleteEvents(request, env, cors) {
  const user = await requireUser(request, env);
  const body = await readJson(request);
  const ids = body && body.eventIds;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 10 || ids.some((id) => !EVENT_ID_PATTERN.test(id))) {
    throw new HttpError(400, "bad_request");
  }

  let deleted = 0;
  for (const id of ids) {
    const look = await gcal(env, user.uid, "GET", CAL + "/" + id);
    if (isGone(look)) { deleted++; continue; }
    if (!look.ok) throw new HttpError(502, "google");
    const event = await look.json().catch(() => ({}));
    if (event.status === "cancelled") { deleted++; continue; }
    const mine = event.extendedProperties && event.extendedProperties.private && event.extendedProperties.private.trackly === "1";
    if (!mine) continue; // never touch an event Trackly did not make

    const gone = await gcal(env, user.uid, "DELETE", CAL + "/" + id);
    if (gone.ok || isGone(gone)) deleted++;
    else throw new HttpError(502, "google");
  }
  return reply({ deleted, requested: ids.length }, 200, cors);
}

async function disconnect(request, env, cors) {
  const user = await requireUser(request, env);
  let removed = 0;
  let budget = DISCONNECT_BUDGET;

  try {
    await accessTokenFor(env, user.uid);
  } catch (err) {
    if (err instanceof HttpError && err.code === "not_connected") return reply({ done: true, removed: 0 }, 200, cors);
    if (err instanceof HttpError && err.code === "reconnect") return reply({ done: true, removed: 0, unreachable: true }, 200, cors);
    throw err;
  }

  while (budget >= 2) {
    const params = new URLSearchParams({ privateExtendedProperty: "trackly=1", maxResults: String(Math.min(25, budget - 1)), showDeleted: "false" });
    const res = await gcal(env, user.uid, "GET", CAL + "?" + params);
    budget--;
    if (!res.ok) throw new HttpError(502, "google");
    const items = ((await res.json().catch(() => ({}))).items || []);
    if (!items.length) break;
    for (const item of items) {
      if (budget < 1) return reply({ done: false, removed }, 200, cors);
      const gone = await gcal(env, user.uid, "DELETE", CAL + "/" + item.id);
      budget--;
      if (gone.ok || isGone(gone)) removed++;
    }
  }
  if (budget < 2) return reply({ done: false, removed }, 200, cors); // the website calls again

  // Nothing of ours is left: take back Google's permission and forget the token
  const stored = await env.CALENDAR.get("tok:" + user.uid, "json");
  if (stored) {
    try {
      const refresh = await decryptToken(env.MASTER_KEY, user.uid, stored);
      await fetch(REVOKE_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: refresh }) });
    } catch (err) { /* forgetting it below is what matters */ }
  }
  await env.CALENDAR.delete("tok:" + user.uid);
  tokenCache.delete(user.uid);
  return reply({ done: true, removed }, 200, cors);
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
          headers: { ...cors, "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Max-Age": "86400" }
        });
      }
      if (request.method === "GET" && url.pathname === "/") return reply({ ok: true, service: "trackly-calendar" }, 200, cors);

      needConfig(env);
      if (request.method === "GET" && url.pathname === "/google/callback") return await callback(url, env);

      // Everything else is for our own website only
      if (!originOk) throw new HttpError(403, "origin_not_allowed");
      if (request.method === "POST" && url.pathname === "/google/start") return await start(request, env, cors, origin);
      if (request.method === "GET" && url.pathname === "/calendar/status") return await status(request, env, cors);
      if (request.method === "POST" && url.pathname === "/calendar/events") return await createEvents(request, env, cors, origin);
      if (request.method === "POST" && url.pathname === "/calendar/delete") return await deleteEvents(request, env, cors);
      if (request.method === "POST" && url.pathname === "/calendar/disconnect") return await disconnect(request, env, cors);
      throw new HttpError(404, "not_found");
    } catch (err) {
      if (err instanceof HttpError) return reply({ error: err.code }, err.status, cors);
      console.error("calendar worker error:", err && err.name, err && err.message); // never log tokens
      return reply({ error: "server" }, 500, cors);
    }
  }
};