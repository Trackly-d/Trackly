import { webcrypto, createECDH, createDecipheriv, hkdfSync, createVerify } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import worker, { runSchedule, resetCaches } from "../worker-push/index.js";
import { encryptPayload, parseSubscription, validEndpoint, importVapid, vapidHeader, resetVapidCache, sendPush } from "../worker-push/lib.js";
import { b64encode, b64decode } from "../worker-calendar/lib.js";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(ok ? "PASS" : "FAIL", name, ok ? "" : "got " + JSON.stringify(got) + " want " + JSON.stringify(want));
};
const enc = new TextEncoder();
const b64u = (bytes) => b64encode(bytes, true);
const HOUR = 3600000;

// ---------- 1. the worked example from RFC 8291 (appendix A): same input must give exactly the same bytes ----------
{
  const asPublic = "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8";
  const raw = b64decode(asPublic);
  const jwk = { kty: "EC", crv: "P-256", d: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw", x: b64u(raw.slice(1, 33)), y: b64u(raw.slice(33, 65)) };
  const body = await encryptPayload(
    enc.encode("When I grow up, I want to be a watermelon"),
    "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
    "BTBZMqHH6r4Tts7J_aSIgg",
    { salt: b64decode("DGv6ra1nlYgDCS1FRnbzlw"), ephemeralJwk: jwk }
  );
  check("RFC 8291 example gives the exact expected bytes", b64u(body),
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN");
}

// ---------- a "browser" that can decrypt, written separately with node:crypto, so the check is independent ----------
function makeDevice() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return {
    sub: (endpoint) => ({ endpoint, keys: { p256dh: b64u(ecdh.getPublicKey()), auth: b64u(auth) } }),
    decrypt(body) {
      const salt = body.slice(0, 16);
      const idlen = body[20];
      const keyid = body.slice(21, 21 + idlen);
      const secret = ecdh.computeSecret(Buffer.from(keyid));
      const info = Buffer.concat([Buffer.from("WebPush: info\0"), ecdh.getPublicKey(), Buffer.from(keyid)]);
      const ikm = Buffer.from(hkdfSync("sha256", secret, Buffer.from(auth), info, 32));
      const cek = Buffer.from(hkdfSync("sha256", ikm, Buffer.from(salt), Buffer.from("Content-Encoding: aes128gcm\0"), 16));
      const nonce = Buffer.from(hkdfSync("sha256", ikm, Buffer.from(salt), Buffer.from("Content-Encoding: nonce\0"), 12));
      const cipher = Buffer.from(body.slice(21 + idlen));
      const d = createDecipheriv("aes-128-gcm", cek, nonce);
      d.setAuthTag(cipher.slice(-16));
      const plain = Buffer.concat([d.update(cipher.slice(0, -16)), d.final()]);
      return { text: plain.slice(0, -1).toString("utf8"), last: plain[plain.length - 1] };
    }
  };
}

{
  const dev = makeDevice();
  const sub = dev.sub("https://fcm.googleapis.com/fcm/send/abc");
  const body = await encryptPayload(enc.encode('{"t":"Hello"}'), sub.keys.p256dh, sub.keys.auth);
  const got = dev.decrypt(body);
  check("a real browser key can decrypt our push", [got.text, got.last], ['{"t":"Hello"}', 2]);
  const again = await encryptPayload(enc.encode('{"t":"Hello"}'), sub.keys.p256dh, sub.keys.auth);
  check("every push uses a fresh salt and key", b64u(body) === b64u(again), false);
  check("record size field says 4096 and the key is 65 bytes", [new DataView(body.buffer, body.byteOffset).getUint32(16), body[20]], [4096, 65]);
}

// ---------- 2. only real push services ----------
check("fcm is allowed", validEndpoint("https://fcm.googleapis.com/fcm/send/x"), true);
check("firefox is allowed", validEndpoint("https://updates.push.services.mozilla.com/wpush/v2/x"), true);
check("safari is allowed", validEndpoint("https://web.push.apple.com/Qx"), true);
check("windows is allowed", validEndpoint("https://sg2p.notify.windows.com/w/?token=x"), true);
check("any other website is refused", validEndpoint("https://evil.example.com/x"), false);
check("a look alike host is refused", validEndpoint("https://fcm.googleapis.com.evil.com/x"), false);
check("plain http is refused", validEndpoint("http://fcm.googleapis.com/x"), false);
check("a login in the address is refused", validEndpoint("https://user:pw@fcm.googleapis.com/x"), false);
check("an odd port is refused", validEndpoint("https://fcm.googleapis.com:8443/x"), false);
check("not a web address is refused", validEndpoint("javascript:alert(1)"), false);
const goodDev = makeDevice();
check("a good subscription passes", parseSubscription(goodDev.sub("https://fcm.googleapis.com/fcm/send/1")).ok, true);
check("a short key is refused", parseSubscription({ endpoint: "https://fcm.googleapis.com/x", keys: { p256dh: "AAAA", auth: "BTBZMqHH6r4Tts7J_aSIgg" } }).ok, false);
check("a missing auth is refused", parseSubscription({ endpoint: "https://fcm.googleapis.com/x", keys: { p256dh: goodDev.sub("x").keys.p256dh } }).ok, false);

// ---------- 3. the VAPID sign in ----------
const vapidPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const vapidJwk = await crypto.subtle.exportKey("jwk", vapidPair.privateKey);
const VAPID_JWK_TEXT = JSON.stringify({ kty: vapidJwk.kty, crv: vapidJwk.crv, x: vapidJwk.x, y: vapidJwk.y, d: vapidJwk.d });
{
  const vapid = await importVapid(VAPID_JWK_TEXT);
  const header = await vapidHeader("https://fcm.googleapis.com/fcm/send/abc", vapid, "https://trackly.ng", 1760000000000);
  const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(header);
  check("the sign in header has the right shape", Boolean(m), true);
  const claims = JSON.parse(Buffer.from(m[2], "base64url").toString());
  check("it names the push service, our site, and lasts under 24 hours", [claims.aud, claims.sub, claims.exp * 1000 - 1760000000000 < 24 * HOUR], ["https://fcm.googleapis.com", "https://trackly.ng", true]);
  const verify = createVerify("SHA256");
  verify.update(m[1] + "." + m[2]);
  const pubKey = (await import("node:crypto")).createPublicKey({ key: { kty: "EC", crv: "P-256", x: vapidJwk.x, y: vapidJwk.y }, format: "jwk" });
  check("the signature checks out against our public key", verify.verify({ key: pubKey, dsaEncoding: "ieee-p1363" }, Buffer.from(m[3], "base64url")), true);
  check("the public key sent is the real 65 byte key", [b64decode(m[4]).length, b64decode(m[4])[0]], [65, 4]);
}

// ---------- 4. the Worker, with a real SQL database (the same engine D1 uses) and a fake push service ----------
const PROJECT = "trackly-e18d8";
const SITE = "http://localhost:5000";
const JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const algo = { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" };
const rsa = await crypto.subtle.generateKey(algo, true, ["sign", "verify"]);
const publicJwk = { ...(await crypto.subtle.exportKey("jwk", rsa.publicKey)), kid: "key1", alg: "RS256", use: "sig" };
async function makeToken(sub = "student-1") {
  const sec = Math.floor(Date.now() / 1000);
  const payload = { aud: PROJECT, iss: "https://securetoken.google.com/" + PROJECT, sub, iat: sec - 10, exp: sec + 3600 };
  const head = b64u(enc.encode(JSON.stringify({ alg: "RS256", kid: "key1", typ: "JWT" })));
  const body = b64u(enc.encode(JSON.stringify(payload)));
  const sig = b64u(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", rsa.privateKey, enc.encode(head + "." + body)));
  return head + "." + body + "." + sig;
}

function makeD1() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../worker-push/schema.sql", import.meta.url), "utf8"));
  const wrap = (sql, args = []) => ({
    bind: (...a) => wrap(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args).map((r) => ({ ...r })) }),
    run: async () => ({ meta: { changes: db.prepare(sql).run(...args).changes } })
  });
  return { prepare: (sql) => wrap(sql), batch: async (list) => { for (const s of list) await s.run(); return []; }, db };
}

const pushCalls = [];
const pushStatus = {}; // endpoint -> status to answer with
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  if (url === JWKS_URL) return new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200, headers: { "Content-Type": "application/json" } });
  pushCalls.push({ url, headers: init.headers, body: init.body });
  return new Response(null, { status: pushStatus[url] || 201 });
};

const d1 = makeD1();
const env = { DB: d1, FIREBASE_PROJECT_ID: PROJECT, VAPID_PRIVATE_JWK: VAPID_JWK_TEXT, VAPID_PUBLIC_KEY: "x", VAPID_SUBJECT: "https://trackly.ng", ALLOWED_ORIGINS: SITE };

async function call(path, body, { token, origin = SITE, method = "POST" } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (origin) headers.Origin = origin;
  if (token !== null) headers.Authorization = "Bearer " + (token || (await makeToken()));
  const res = await worker.fetch(new Request("https://push.example" + path, { method, headers, body: method === "POST" ? JSON.stringify(body || {}) : undefined }), env);
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

const phone = makeDevice();
const laptop = makeDevice();
const PHONE = "https://fcm.googleapis.com/fcm/send/phone";
const LAPTOP = "https://updates.push.services.mozilla.com/wpush/v2/laptop";

check("no sign in is refused", (await call("/push/subscribe", {}, { token: null })).status, 401);
check("a website we do not know is refused", (await call("/push/subscribe", {}, { origin: "https://evil.example" })).status, 403);
check("a bad subscription is refused", (await call("/push/subscribe", { subscription: { endpoint: "https://evil.example/x", keys: {} } })).data.error, "bad_subscription");
check("the phone is saved", (await call("/push/subscribe", { subscription: phone.sub(PHONE) })).data.devices, 1);
check("the laptop is saved", (await call("/push/subscribe", { subscription: laptop.sub(LAPTOP) })).data.devices, 2);
check("saving the same device again does not make a copy", (await call("/push/subscribe", { subscription: laptop.sub(LAPTOP) })).data.devices, 2);

// an event goes to the OTHER device only
await call("/push/prefs", { alertsEnabled: true, alertHours: [48, 24], types: { added: true, edited: false } });
pushCalls.length = 0;
let r = await call("/push/event", { kind: "added", id: "a1", title: "Chapter 5 Essay", courseName: "Biology" });
check("an event is sent to every device, the one that did it too", [r.data.sent, pushCalls.map((c) => c.url).sort()], [2, [LAPTOP, PHONE].sort()]);
check("both devices get the same readable message", [JSON.parse(phone.decrypt(pushCalls.find((c) => c.url === PHONE).body).text).t, JSON.parse(laptop.decrypt(pushCalls.find((c) => c.url === LAPTOP).body).text).t], ["Chapter 5 Essay added", "Chapter 5 Essay added"]);
const msg = JSON.parse(laptop.decrypt(pushCalls.find((c) => c.url === LAPTOP).body).text);
check("the message reads well and opens the assignment", [msg.t, msg.b, msg.u], ["Chapter 5 Essay added", "Course: Biology", "/assignment.html?id=a1"]);
check("the push is signed with our key", /^vapid t=.+, k=.+$/.test(pushCalls[0].headers.Authorization), true);
pushCalls.length = 0;
r = await call("/push/event", { kind: "edited", id: "a1", title: "x" });
check("a kind that is switched off sends nothing", [r.data.sent, pushCalls.length], [0, 0]);
check("an unknown kind is refused", (await call("/push/event", { kind: "hack", id: "a1" })).data.error, "bad_kind");
check("an odd id is refused", (await call("/push/event", { kind: "added", id: "../x" })).data.error, "bad_id");

// another student never gets this student's pushes, and cannot see them
pushCalls.length = 0;
r = await call("/push/event", { kind: "added", id: "a9", title: "T" }, { token: await makeToken("student-2") });
check("another student has no devices, so nothing is sent", [r.data.sent, pushCalls.length], [0, 0]);

// a push service says the device is gone: forget it
pushStatus[LAPTOP] = 410;
await call("/push/event", { kind: "added", id: "a2", title: "T" });
pushStatus[LAPTOP] = 0;
check("a device the push service no longer knows is forgotten", d1.db.prepare("SELECT COUNT(*) AS n FROM device").get().n, 1);
await call("/push/subscribe", { subscription: laptop.sub(LAPTOP) });

// the same browser used by someone else moves to them
await call("/push/subscribe", { subscription: laptop.sub(LAPTOP) }, { token: await makeToken("student-2") });
check("a push address belongs to one student: it moved", d1.db.prepare("SELECT uid FROM device WHERE endpoint = ?").get(LAPTOP).uid, "student-2");
await call("/push/subscribe", { subscription: laptop.sub(LAPTOP) });

// the timed alerts
const NOW = Date.now();
const watchBody = (id, dueIn, extra = {}) => ({ items: [{ assignmentId: id, title: "Lab Report", courseName: "Chem", dueAt: new Date(NOW + dueIn).toISOString(), createdAt: new Date(NOW - 5 * HOUR).toISOString(), status: "open", ...extra }] });
check("watch is saved", (await call("/push/watch", watchBody("w1", 49 * HOUR))).data.count, 1);
check("an assignment already past due is not watched", (await call("/push/watch", watchBody("w2", -HOUR))).data.count, 1);
check("a bad id is refused", (await call("/push/watch", watchBody("a b", HOUR))).data.error, "bad_assignment");
check("too many items are refused", (await call("/push/watch", { items: Array.from({ length: 26 }, (_, i) => watchBody("x" + i, HOUR).items[0]) })).data.error, "bad_items");
check("only w1 is waiting", d1.db.prepare("SELECT aid FROM watch").all().map((x) => x.aid), ["w1"]);

pushCalls.length = 0;
let s = await runSchedule(env, NOW);
let row = d1.db.prepare("SELECT state, next_kind, next_hours, next_at FROM watch WHERE aid = 'w1'").get();
check("first the next time is worked out: the 48 hour alert", [s.sent, row.state, row.next_kind, row.next_hours, row.next_at - NOW], [0, 1, "due", 48, HOUR]);

pushCalls.length = 0;
s = await runSchedule(env, NOW + HOUR + 1000);
check("at that time both devices get the 48 hour push", [s.sent, pushCalls.length], [2, 2]);
check("it says what is due", JSON.parse(phone.decrypt(pushCalls.find((c) => c.url === PHONE).body).text).t, "Lab Report is due in 48 hours");
row = d1.db.prepare("SELECT next_kind, next_hours FROM watch WHERE aid = 'w1'").get();
check("then it waits for the 24 hour alert", [row.next_kind, row.next_hours], ["due", 24]);

pushCalls.length = 0;
s = await runSchedule(env, NOW + HOUR + 60000);
check("nothing is sent twice", pushCalls.length, 0);

pushCalls.length = 0;
await runSchedule(env, NOW + 25 * HOUR + 1000); // the 24 hour time
await runSchedule(env, NOW + 49 * HOUR + 1000); // the due time itself
check("the 24 hour push and the overdue push both went out", pushCalls.length >= 4, true);
check("the last one says overdue", JSON.parse(phone.decrypt(pushCalls.filter((c) => c.url === PHONE).slice(-1)[0].body).text).t, "Lab Report is overdue");
check("a finished assignment is forgotten", d1.db.prepare("SELECT COUNT(*) AS n FROM watch").get().n, 0);

// a push that is far too late is dropped, not sent stale
await call("/push/watch", watchBody("w3", 49 * HOUR));
await runSchedule(env, NOW);
pushCalls.length = 0;
await runSchedule(env, NOW + 3 * HOUR); // the 48 hour time was 2 hours ago
check("a push more than 30 minutes late is dropped", pushCalls.length, 0);
row = d1.db.prepare("SELECT next_hours FROM watch WHERE aid = 'w3'").get();
check("and the next alert is still waiting", row.next_hours, 24);

// changing the alert times works the waiting assignments out again
await call("/push/prefs", { alertsEnabled: true, alertHours: [3], types: {} });
await runSchedule(env, NOW + 3 * HOUR);
row = d1.db.prepare("SELECT next_hours FROM watch WHERE aid = 'w3'").get();
check("new alert times take effect", row.next_hours, 3);

// alerts switched off: nothing to send, and the row goes away
await call("/push/prefs", { alertsEnabled: false, alertHours: [3], types: {} });
await runSchedule(env, NOW + 3 * HOUR);
check("alerts off means nothing waits", d1.db.prepare("SELECT COUNT(*) AS n FROM watch").get().n, 0);

// closing or deleting an assignment stops its pushes
await call("/push/prefs", { alertsEnabled: true, alertHours: [48, 24], types: {} });
await call("/push/watch", watchBody("w4", 60 * HOUR));
await call("/push/watch", { items: [{ assignmentId: "w4", status: "closed" }] });
check("a submitted assignment is no longer watched", d1.db.prepare("SELECT COUNT(*) AS n FROM watch").get().n, 0);

// unsubscribe and delete everything
check("this device can be removed", (await call("/push/unsubscribe", { endpoint: PHONE })).data.devices, 1);
check("an odd address cannot be removed", (await call("/push/unsubscribe", { endpoint: "https://evil.example/x" })).status, 400);
await call("/push/watch", watchBody("w5", 60 * HOUR));
await call("/push/delete-all", {});
const left = ["device", "watch", "prefs"].map((t) => d1.db.prepare("SELECT COUNT(*) AS n FROM " + t + " WHERE uid = 'student-1'").get().n);
check("delete everything leaves nothing of this student", left, [0, 0, 0]);

check("an unknown path is not found", (await call("/push/nope", {})).status, 404);
check("a GET on a push path is not found", (await call("/push/subscribe", null, { method: "GET" })).status, 404);
const bad = await worker.fetch(new Request("https://push.example/push/subscribe", { method: "POST", headers: { Origin: SITE, Authorization: "Bearer " + (await makeToken()) }, body: "{not json" }), env);
check("broken data is a plain 400", bad.status, 400);
const noConfig = await worker.fetch(new Request("https://push.example/push/subscribe", { method: "POST", headers: { Origin: SITE } }), { ...env, VAPID_PRIVATE_JWK: "" });
check("missing setup is reported, not crashed", noConfig.status, 500);

console.log(failed ? failed + " FAILED" : "ALL PASSED");
process.exit(failed ? 1 : 0);
