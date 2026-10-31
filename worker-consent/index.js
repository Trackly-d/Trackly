/* ==========================================================
   TRACKLY consent worker
   Handles parental approval for students under 18, with a real email to the parent or guardian.

   The journey:
     1. The student types a parent's email.                   POST /consent/request   (no sign in yet, so it is rate limited)
        The Worker emails the parent a link, and keeps NO readable email: only scrambled copies.
     2. The student's page asks "did they answer?"            POST /consent/status
     3. The parent opens the link and approves or declines.   POST /consent/lookup, POST /consent/answer
     4. The student creates their account, and the account    POST /consent/claim     (needs the student's sign in)
        "claims" the approval. One approval can be used for ONE account only.
     5. Deleting the account removes the consent record.      POST /consent/delete-account (needs sign in)

   What is kept, and for how long:
     pending or approved but never used ... 7 days, then deleted (hourly cleanup)
     declined ............................... the scrambled email is wiped at once, the empty note is deleted after 7 days
     approved and used by an account ........ kept as proof of consent (scrambled email + times) until that account is deleted

   Needs (see README.md): D1 binding DB, secrets RESEND_API_KEY and CONSENT_PEPPER,
   settings FIREBASE_PROJECT_ID, SITE_URL, MAIL_FROM, ALLOWED_ORIGINS
   ========================================================== */

import { allowedOrigins, verifyFirebaseToken } from "../worker-calendar/lib.js";
import { normalizeParentEmail, EXPIRY_DAYS } from "../js/consent-logic.js";
import { randomCode, sha256Hex, hmacHex, approvalLink, buildEmail, sendEmail } from "./lib.js";

const DAY = 86400000;
const HOUR = 3600000;
const EXPIRY_MS = EXPIRY_DAYS * DAY;
const MAX_BODY = 2048;
const PER_IP_PER_HOUR = 5;          // one phone or home can ask a few times
const PER_EMAIL_PER_DAY = 2;        // one parent is never flooded
const GLOBAL_PER_DAY = 80;          // Resend's free plan stops at 100 a day, this stays under it
const CODE_PATTERN = /^[\w-]{16,64}$/;

class HttpError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}

function reply(data, status, cors) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...cors }
  });
}

function needConfig(env) {
  if (!(env.DB && env.CONSENT_PEPPER && env.RESEND_API_KEY && env.MAIL_FROM && env.SITE_URL && env.FIREBASE_PROJECT_ID)) throw new HttpError(500, "not_configured");
}

async function readJson(request) {
  const text = await request.text();
  if (text.length > MAX_BODY) throw new HttpError(413, "too_big");
  try { const data = JSON.parse(text); return data && typeof data === "object" ? data : {}; } catch (err) { throw new HttpError(400, "bad_request"); }
}

async function requireUser(request, env) {
  const header = request.headers.get("Authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const user = await verifyFirebaseToken(token, { projectId: env.FIREBASE_PROJECT_ID });
  if (!user) throw new HttpError(401, "sign_in_needed");
  return user;
}

/* Counts one use of `key`. Returns true while it is still under the limit. */
async function hit(env, key, limit, now) {
  const row = await env.DB.prepare(
    "INSERT INTO ratelimit (key, n, at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET n = n + 1 RETURNING n"
  ).bind(key, now).first();
  return row.n <= limit;
}

/* The state of a request as the outside world sees it */
function stateOf(row, now) {
  if (!row) return "unknown";
  if (row.status === "pending" && now > row.expires_at) return "expired";
  if (row.status === "approved" && !row.claimed_by && now > row.expires_at) return "expired";
  return row.status;
}

/* ---------- 1. the student asks a parent ---------- */
async function createRequest(request, env, cors, now) {
  const body = await readJson(request);
  const email = normalizeParentEmail(body.parentEmail);
  if (!email) throw new HttpError(400, "bad_email");

  const day = Math.floor(now / DAY);
  const hour = Math.floor(now / HOUR);
  const emailHash = await hmacHex(env.CONSENT_PEPPER, "email:" + email);
  const ipHash = await hmacHex(env.CONSENT_PEPPER, "ip:" + (request.headers.get("CF-Connecting-IP") || "unknown"));

  if (!(await hit(env, "g:" + day, GLOBAL_PER_DAY, now))) throw new HttpError(429, "busy");
  if (!(await hit(env, "i:" + ipHash + ":" + hour, PER_IP_PER_HOUR, now))) throw new HttpError(429, "too_many");
  if (!(await hit(env, "e:" + emailHash + ":" + day, PER_EMAIL_PER_DAY, now))) throw new HttpError(429, "too_many");

  const id = randomCode(16);
  const token = randomCode(32);
  await env.DB.prepare(
    "INSERT INTO request (id, token_hash, email_hash, status, created_at, expires_at) VALUES (?, ?, ?, 'pending', ?, ?)"
  ).bind(id, await sha256Hex(token), emailHash, now, now + EXPIRY_MS).run();

  const mail = buildEmail({ link: approvalLink(env.SITE_URL, token), siteUrl: env.SITE_URL, days: EXPIRY_DAYS });
  const sent = await sendEmail(env, { to: email, ...mail }, env.fetchFn || fetch);
  if (!sent.ok) {
    await env.DB.prepare("DELETE FROM request WHERE id = ?").bind(id).run(); // nothing waits for an email that never left
    console.error("consent email not sent, provider status", sent.status);
    throw new HttpError(502, "email_failed");
  }
  return reply({ id, expiresAt: new Date(now + EXPIRY_MS).toISOString() }, 200, cors);
}

/* ---------- 2. the student's page asks if the parent answered ---------- */
async function status(request, env, cors, now) {
  const body = await readJson(request);
  if (!CODE_PATTERN.test(body.id || "")) throw new HttpError(400, "bad_id");
  const row = await env.DB.prepare("SELECT status, expires_at, claimed_by FROM request WHERE id = ?").bind(body.id).first();
  return reply({ status: stateOf(row, now) }, 200, cors);
}

/* ---------- 3. the parent opens the link ---------- */
async function tokenRow(env, token) {
  if (!CODE_PATTERN.test(token || "")) return null;
  return env.DB.prepare("SELECT id, status, expires_at, claimed_by FROM request WHERE token_hash = ?").bind(await sha256Hex(token)).first();
}

async function lookup(request, env, cors, now) {
  const body = await readJson(request);
  return reply({ status: stateOf(await tokenRow(env, body.token), now) }, 200, cors);
}

async function answer(request, env, cors, now) {
  const body = await readJson(request);
  if (body.decision !== "approve" && body.decision !== "decline") throw new HttpError(400, "bad_decision");
  const row = await tokenRow(env, body.token);
  const state = stateOf(row, now);
  if (state !== "pending") return reply({ error: "not_pending", status: state }, 409, cors);

  if (body.decision === "approve") {
    await env.DB.prepare("UPDATE request SET status = 'approved', answered_at = ? WHERE id = ? AND status = 'pending'").bind(now, row.id).run();
    return reply({ status: "approved" }, 200, cors);
  }
  // declined: the scrambled email and the link secret are wiped at once
  await env.DB.prepare("UPDATE request SET status = 'declined', answered_at = ?, email_hash = '', token_hash = 'declined:' || id WHERE id = ? AND status = 'pending'").bind(now, row.id).run();
  return reply({ status: "declined" }, 200, cors);
}

/* ---------- 4. the new account uses the approval (once) ---------- */
async function claim(request, env, cors, now) {
  const user = await requireUser(request, env);
  const body = await readJson(request);
  if (!CODE_PATTERN.test(body.id || "")) throw new HttpError(400, "bad_id");
  const row = await env.DB.prepare("SELECT status, expires_at, answered_at, claimed_by FROM request WHERE id = ?").bind(body.id).first();
  if (!row) throw new HttpError(404, "not_found");
  if (row.claimed_by && row.claimed_by !== user.uid) throw new HttpError(409, "already_used");
  if (row.claimed_by === user.uid) return reply({ approvedAt: new Date(row.answered_at).toISOString() }, 200, cors); // asking twice is fine
  if (stateOf(row, now) !== "approved") throw new HttpError(409, "not_approved");
  const done = await env.DB.prepare("UPDATE request SET claimed_by = ?, claimed_at = ? WHERE id = ? AND claimed_by IS NULL").bind(user.uid, now, body.id).run();
  if (!done.meta || done.meta.changes !== 1) throw new HttpError(409, "already_used"); // someone else got there in the same moment
  return reply({ approvedAt: new Date(row.answered_at).toISOString() }, 200, cors);
}

/* ---------- 5. the account is deleted ---------- */
async function deleteAccountData(request, env, cors) {
  const user = await requireUser(request, env);
  await env.DB.prepare("DELETE FROM request WHERE claimed_by = ?").bind(user.uid).run();
  return reply({ ok: true }, 200, cors);
}

/* ---------- the hourly cleanup ---------- */
export async function runCleanup(env, now = Date.now()) {
  const gone = await env.DB.prepare("DELETE FROM request WHERE claimed_by IS NULL AND expires_at < ?").bind(now).run();
  await env.DB.prepare("DELETE FROM ratelimit WHERE at < ?").bind(now - 2 * DAY).run();
  return { removed: gone.meta ? gone.meta.changes : 0 };
}

/* ---------- entry point ---------- */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const originOk = Boolean(origin) && allowedOrigins(env).includes(origin);
    const cors = originOk ? { "Access-Control-Allow-Origin": origin, "Vary": "Origin" } : {};

    try {
      if (request.method === "OPTIONS") {
        if (!originOk) return new Response("Not allowed", { status: 403 });
        return new Response(null, { status: 204, headers: { ...cors, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Max-Age": "86400" } });
      }
      if (request.method === "GET" && url.pathname === "/") return reply({ ok: true, service: "trackly-consent" }, 200, cors);

      needConfig(env);
      if (!originOk) throw new HttpError(403, "origin_not_allowed");
      if (request.method !== "POST") throw new HttpError(404, "not_found");

      const now = Date.now();
      switch (url.pathname) {
        case "/consent/request": return await createRequest(request, env, cors, now);
        case "/consent/status": return await status(request, env, cors, now);
        case "/consent/lookup": return await lookup(request, env, cors, now);
        case "/consent/answer": return await answer(request, env, cors, now);
        case "/consent/claim": return await claim(request, env, cors, now);
        case "/consent/delete-account": return await deleteAccountData(request, env, cors);
        default: throw new HttpError(404, "not_found");
      }
    } catch (err) {
      if (err instanceof HttpError) return reply({ error: err.code }, err.status, cors);
      console.error("consent worker error:", err && err.name, err && err.message); // never log emails, tokens or keys
      return reply({ error: "server" }, 500, cors);
    }
  },

  async scheduled(controller, env, ctx) {
    try {
      needConfig(env);
      ctx.waitUntil(runCleanup(env).catch((err) => console.error("consent cleanup error:", err && err.name, err && err.message)));
    } catch (err) {
      console.error("consent cron error:", err && err.name, err && err.message);
    }
  }
};
