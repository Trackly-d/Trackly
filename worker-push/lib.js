/* ==========================================================
   TRACKLY push worker: shared logic
   Pure functions that need no Cloudflare, so tests/worker-push.test.mjs can run them in Node.
     - Web Push encryption (RFC 8291, aes128gcm) and the VAPID sign in (RFC 8292), written with Web Crypto only
     - checking what the website sends (a push address must belong to a real push service)
   Nothing here logs or returns a student's push address or keys.
   ========================================================== */

import { b64decode, b64encode } from "../worker-calendar/lib.js";

const enc = new TextEncoder();
const b64url = (bytes) => b64encode(bytes, true);

/* ---------- checking the push address ----------
   The Worker sends a web request to whatever address the website gives it, so the address must be a known push
   service. Without this check, a signed in student could make our Worker call any website. */
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,                       // Chrome, Edge, Brave, Opera, Samsung Internet, Android
  /^android\.googleapis\.com$/,
  /(^|\.)push\.services\.mozilla\.com$/,          // Firefox
  /(^|\.)push\.apple\.com$/,                      // Safari and the iPhone Home Screen
  /(^|\.)notify\.windows\.com$/                   // older Edge
];

export function validEndpoint(value) {
  try {
    const u = new URL(String(value));
    if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return false;
    if (String(value).length > 600) return false;
    return PUSH_HOSTS.some((re) => re.test(u.hostname));
  } catch (err) {
    return false;
  }
}

/* Returns { ok, value } or { ok: false } */
export function parseSubscription(sub) {
  if (!sub || typeof sub !== "object" || !validEndpoint(sub.endpoint) || !sub.keys) return { ok: false };
  try {
    const p256dh = b64decode(sub.keys.p256dh);
    const auth = b64decode(sub.keys.auth);
    if (p256dh.length !== 65 || p256dh[0] !== 4 || auth.length !== 16) return { ok: false };
    return { ok: true, value: { endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth } };
  } catch (err) {
    return { ok: false };
  }
}

export async function endpointHash(endpoint) {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(endpoint));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* ---------- VAPID: proves to the push service that the push really comes from our Worker ---------- */
export async function importVapid(privateJwkText) {
  const jwk = JSON.parse(privateJwkText);
  const privateKey = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const raw = new Uint8Array(65);
  raw[0] = 4;
  raw.set(b64decode(jwk.x), 1);
  raw.set(b64decode(jwk.y), 33);
  return { privateKey, publicKey: b64url(raw) };
}

const jwtCache = new Map(); // one signed token per push service, good for hours

export async function vapidHeader(endpoint, vapid, subject, now = Date.now()) {
  const aud = new URL(endpoint).origin;
  const hit = jwtCache.get(aud);
  let jwt = hit && hit.exp - now > 3600 * 1000 ? hit.jwt : null;
  if (!jwt) {
    const exp = now + 12 * 3600 * 1000; // push services allow up to 24 hours
    const head = b64url(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
    const claims = b64url(enc.encode(JSON.stringify({ aud, exp: Math.floor(exp / 1000), sub: subject })));
    const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, vapid.privateKey, enc.encode(head + "." + claims));
    jwt = head + "." + claims + "." + b64url(sig);
    jwtCache.set(aud, { jwt, exp });
  }
  return "vapid t=" + jwt + ", k=" + vapid.publicKey;
}
export function resetVapidCache() { jwtCache.clear(); }

/* ---------- Encrypting the message (RFC 8291) ----------
   payload: bytes. uaPublic and auth: the browser's keys, base64url. salt and ephemeral exist only so tests can
   use the fixed example from the RFC; in real use both are made fresh for every push. */
function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8));
}

export async function encryptPayload(payload, uaPublicB64, authB64, { salt, ephemeralJwk } = {}) {
  const uaPublic = b64decode(uaPublicB64);
  const auth = b64decode(authB64);
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);

  let pair;
  if (ephemeralJwk) {
    const priv = await crypto.subtle.importKey("jwk", ephemeralJwk, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
    pair = { privateKey: priv };
  } else {
    pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  }
  let asPublic;
  if (ephemeralJwk) {
    asPublic = new Uint8Array(65);
    asPublic[0] = 4;
    asPublic.set(b64decode(ephemeralJwk.x), 1);
    asPublic.set(b64decode(ephemeralJwk.y), 33);
  } else {
    asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  }

  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, pair.privateKey, 256));
  const theSalt = salt || crypto.getRandomValues(new Uint8Array(16));

  const ikm = await hkdf(auth, shared, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic), 32);
  const cek = await hkdf(theSalt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(theSalt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);

  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, concat(payload, new Uint8Array([2]))));

  const header = new Uint8Array(21);
  header.set(theSalt, 0);
  new DataView(header.buffer).setUint32(16, 4096, false);
  header[20] = 65;
  return concat(header, asPublic, cipher);
}

/* ---------- Sending one push ----------
   Returns { ok, gone, status }. gone is true when the push service says this address no longer exists (the student
   removed the app or revoked permission), so the Worker forgets it. */
export async function sendPush(sub, message, { vapid, subject, fetchFn = fetch, ttl = 3600, now = Date.now() }) {
  const body = await encryptPayload(enc.encode(JSON.stringify(message)), sub.p256dh, sub.auth);
  let res;
  try {
    res = await fetchFn(sub.endpoint, {
      method: "POST",
      headers: {
        Authorization: await vapidHeader(sub.endpoint, vapid, subject, now),
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: String(ttl),
        Urgency: "normal"
      },
      body
    });
  } catch (err) {
    return { ok: false, gone: false, status: 0 };
  }
  return { ok: res.status >= 200 && res.status < 300, gone: res.status === 404 || res.status === 410, status: res.status };
}
