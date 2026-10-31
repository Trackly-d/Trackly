import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import worker, { runCleanup } from "../worker-consent/index.js";
import { buildEmail, approvalLink, sha256Hex, hmacHex, randomCode } from "../worker-consent/lib.js";
import { b64encode } from "../worker-calendar/lib.js";

if (!globalThis.crypto) globalThis.crypto = webcrypto;
let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(ok ? "PASS" : "FAIL", name, ok ? "" : "got " + JSON.stringify(got) + " want " + JSON.stringify(want));
};
const enc = new TextEncoder();
const b64u = (bytes) => b64encode(bytes, true);
const DAY = 86400000;

// ---------- the words and the scrambling ----------
const mail = buildEmail({ link: "https://trackly.ng/parent-approval?token=abc", siteUrl: "https://trackly.ng/", days: 7 });
check("the email has a clear subject", mail.subject, "Please approve a Trackly account");
check("the link is in both the plain and the pretty version", [mail.text.includes("parent-approval?token=abc"), mail.html.includes('href="https://trackly.ng/parent-approval?token=abc"')], [true, true]);
check("it says the link lasts 7 days, can be used once and that nothing is created without approval", [/7 days/.test(mail.text), /once/.test(mail.text), /only created if you approve/.test(mail.text)], [true, true, true]);
check("it says we keep no readable email", /do not keep your email address in readable form/.test(mail.text), true);
check("it never contains a student's name or email", /@/.test(mail.text.replace(/trackly\.ng/g, "")), false);
check("the link adds the token safely", approvalLink("https://trackly.ng/", "a b/c"), "https://trackly.ng/parent-approval?token=a%20b%2Fc");
check("a hash is stable, and different for different input", [await sha256Hex("x") === await sha256Hex("x"), await sha256Hex("x") === await sha256Hex("y")], [true, false]);
check("the email scramble needs the secret", await hmacHex("one", "a@b.com") === await hmacHex("two", "a@b.com"), false);
check("random codes are long and never repeat", [randomCode(16).length >= 21, randomCode(32).length >= 42, randomCode(16) === randomCode(16)], [true, true, false]);

// ---------- a fake Firebase and a fake Resend ----------
const PROJECT = "trackly-e18d8";
const SITE = "http://localhost:5000";
const JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const algo = { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" };
const rsa = await crypto.subtle.generateKey(algo, true, ["sign", "verify"]);
const publicJwk = { ...(await crypto.subtle.exportKey("jwk", rsa.publicKey)), kid: "key1", alg: "RS256", use: "sig" };
async function makeToken(sub) {
  const sec = Math.floor(Date.now() / 1000);
  const payload = { aud: PROJECT, iss: "https://securetoken.google.com/" + PROJECT, sub, iat: sec - 10, exp: sec + 3600 };
  const head = b64u(enc.encode(JSON.stringify({ alg: "RS256", kid: "key1", typ: "JWT" })));
  const body = b64u(enc.encode(JSON.stringify(payload)));
  return head + "." + body + "." + b64u(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", rsa.privateKey, enc.encode(head + "." + body)));
}

const sent = [];
let resendStatus = 200;
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  if (url === JWKS_URL) return new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200, headers: { "Content-Type": "application/json" } });
  if (url === "https://api.resend.com/emails") { sent.push({ headers: init.headers, body: JSON.parse(init.body) }); return new Response("{}", { status: resendStatus }); }
  throw new Error("unexpected request to " + url);
};

function makeD1() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../worker-consent/schema.sql", import.meta.url), "utf8"));
  const wrap = (sql, args = []) => ({
    bind: (...a) => wrap(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args).map((r) => ({ ...r })) }),
    run: async () => ({ meta: { changes: db.prepare(sql).run(...args).changes } })
  });
  return { prepare: (sql) => wrap(sql), db };
}
const d1 = makeD1();
const env = { DB: d1, FIREBASE_PROJECT_ID: PROJECT, SITE_URL: "https://trackly.ng", MAIL_FROM: "Trackly <no-reply@trackly.ng>", RESEND_API_KEY: "re_test", CONSENT_PEPPER: "pepper-for-tests", ALLOWED_ORIGINS: SITE };
let ipCounter = 0;
async function call(path, body, { token, origin = SITE, method = "POST", ip } = {}) {
  const headers = { "Content-Type": "application/json", "CF-Connecting-IP": ip || "203.0.113." + ++ipCounter };
  if (origin) headers.Origin = origin;
  if (token) headers.Authorization = "Bearer " + token;
  const res = await worker.fetch(new Request("https://consent.example" + path, { method, headers, body: method === "POST" ? JSON.stringify(body || {}) : undefined }), env);
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
const tokenFromMail = (m) => decodeURIComponent(/parent-approval\?token=([^\s"&]+)/.exec(m.body.text)[1]);

// ---------- 1. asking a parent ----------
check("a bad email is refused", (await call("/consent/request", { parentEmail: "not an email" })).data.error, "bad_email");
check("an email with a comma is refused", (await call("/consent/request", { parentEmail: "a@b.com,c@d.com" })).data.error, "bad_email");
check("an unknown website is refused", (await call("/consent/request", { parentEmail: "mum@example.com" }, { origin: "https://evil.example" })).status, 403);
check("no emails went out for those", sent.length, 0);

let r = await call("/consent/request", { parentEmail: "  Mum@Example.com " });
check("a good request returns a public code and an expiry", [r.status, typeof r.data.id, new Date(r.data.expiresAt).getTime() - Date.now() > 6.9 * DAY], [200, "string", true]);
const id1 = r.data.id;
check("exactly one email went to the parent, from our address", [sent.length, sent[0].body.to, sent[0].body.from, sent[0].headers.Authorization], [1, ["mum@example.com"], "Trackly <no-reply@trackly.ng>", "Bearer re_test"]);
const token1 = tokenFromMail(sent[0]);
check("the link points at our site and the secret is long", [sent[0].body.text.includes("https://trackly.ng/parent-approval?token="), token1.length >= 42], [true, true]);

const everything = JSON.stringify(d1.db.prepare("SELECT * FROM request").all()) + JSON.stringify(d1.db.prepare("SELECT * FROM ratelimit").all());
check("NO readable email, token or ip is stored anywhere", [/example\.com/.test(everything), everything.includes(token1), everything.includes("203.0.113")], [false, false, false]);

// limits
check("one parent is not flooded: 2 a day", [(await call("/consent/request", { parentEmail: "mum@example.com" })).status, (await call("/consent/request", { parentEmail: "mum@example.com" })).data.error], [200, "too_many"]);
const sameIp = "198.51.100.7";
const results = [];
for (let i = 0; i < 6; i++) results.push((await call("/consent/request", { parentEmail: "p" + i + "@example.com" }, { ip: sameIp })).status);
check("one network can ask 5 times an hour, the 6th is refused", results, [200, 200, 200, 200, 200, 429]);
d1.db.prepare("INSERT OR REPLACE INTO ratelimit (key, n, at) VALUES (?, 80, ?)").run("g:" + Math.floor(Date.now() / DAY), Date.now());
check("when the daily email allowance is used up, everyone is told to wait", (await call("/consent/request", { parentEmail: "late@example.com" })).data.error, "busy");
d1.db.prepare("DELETE FROM ratelimit").run();

resendStatus = 500;
const before = d1.db.prepare("SELECT COUNT(*) AS n FROM request").get().n;
r = await call("/consent/request", { parentEmail: "fail@example.com" });
check("if the email cannot be sent the student is told, and nothing is left waiting", [r.status, r.data.error, d1.db.prepare("SELECT COUNT(*) AS n FROM request").get().n], [502, "email_failed", before]);
resendStatus = 200;

// ---------- 2 and 3. waiting and answering ----------
check("the student's page sees pending", (await call("/consent/status", { id: id1 })).data.status, "pending");
check("an odd id is refused", (await call("/consent/status", { id: "../x" })).data.error, "bad_id");
check("an unknown id is just unknown", (await call("/consent/status", { id: "A".repeat(22) })).data.status, "unknown");
check("the parent's page sees pending", (await call("/consent/lookup", { token: token1 })).data.status, "pending");
check("a wrong token is unknown, never an error that helps a guesser", (await call("/consent/lookup", { token: "B".repeat(43) })).data.status, "unknown");
check("a bad decision is refused", (await call("/consent/answer", { token: token1, decision: "maybe" })).data.error, "bad_decision");
check("approve works", (await call("/consent/answer", { token: token1, decision: "approve" })).data.status, "approved");
check("the student's page sees approved", (await call("/consent/status", { id: id1 })).data.status, "approved");
r = await call("/consent/answer", { token: token1, decision: "decline" });
check("a second answer cannot change it", [r.status, r.data.status], [409, "approved"]);

// declined
r = await call("/consent/request", { parentEmail: "dad@example.com" });
const idDecl = r.data.id; const tokDecl = tokenFromMail(sent[sent.length - 1]);
check("decline works", (await call("/consent/answer", { token: tokDecl, decision: "decline" })).data.status, "declined");
const declRow = d1.db.prepare("SELECT email_hash, token_hash, status FROM request WHERE id = ?").get(idDecl);
check("a declined request is wiped at once", [declRow.email_hash, declRow.token_hash.startsWith("declined:"), declRow.status], ["", true, "declined"]);
check("the student sees declined", (await call("/consent/status", { id: idDecl })).data.status, "declined");
check("the old link is dead", (await call("/consent/lookup", { token: tokDecl })).data.status, "unknown");

// expiry
r = await call("/consent/request", { parentEmail: "aunt@example.com" });
const idExp = r.data.id; const tokExp = tokenFromMail(sent[sent.length - 1]);
d1.db.prepare("UPDATE request SET expires_at = ? WHERE id = ?").run(Date.now() - 1000, idExp);
check("an old pending request is expired", [(await call("/consent/status", { id: idExp })).data.status, (await call("/consent/lookup", { token: tokExp })).data.status], ["expired", "expired"]);
r = await call("/consent/answer", { token: tokExp, decision: "approve" });
check("an expired link cannot approve", [r.status, r.data.status], [409, "expired"]);

// ---------- 4. the account uses the approval ----------
const alice = await makeToken("alice");
const bob = await makeToken("bob");
check("claiming needs a sign in", (await call("/consent/claim", { id: id1 })).status, 401);
r = await call("/consent/claim", { id: idDecl }, { token: alice });
check("a declined approval cannot be claimed", [r.status, r.data.error], [409, "not_approved"]);
r = await call("/consent/claim", { id: "C".repeat(22) }, { token: alice });
check("an unknown approval cannot be claimed", r.status, 404);
r = await call("/consent/claim", { id: id1 }, { token: alice });
check("an approved request is claimed by the new account", [r.status, Boolean(new Date(r.data.approvedAt).getTime())], [200, true]);
check("claiming again by the same account is fine", (await call("/consent/claim", { id: id1 }, { token: alice })).status, 200);
r = await call("/consent/claim", { id: id1 }, { token: bob });
check("one approval cannot be used for a second account", [r.status, r.data.error], [409, "already_used"]);
check("the record keeps who used it", d1.db.prepare("SELECT claimed_by FROM request WHERE id = ?").get(id1).claimed_by, "alice");

// ---------- 5. cleanup and deletion ----------
r = await call("/consent/request", { parentEmail: "old@example.com" });
d1.db.prepare("UPDATE request SET expires_at = ? WHERE id = ?").run(Date.now() - 1000, r.data.id);
d1.db.prepare("UPDATE request SET expires_at = ? WHERE id = ?").run(Date.now() - 1000, id1); // claimed: must survive
const cleaned = await runCleanup(env);
check("the hourly cleanup removes ran-out requests but keeps a used approval", [cleaned.removed >= 1, d1.db.prepare("SELECT COUNT(*) AS n FROM request WHERE id = ?").get(id1).n, d1.db.prepare("SELECT COUNT(*) AS n FROM request WHERE id = ?").get(r.data.id).n], [true, 1, 0]);
check("deleting the account needs a sign in", (await call("/consent/delete-account", {})).status, 401);
await call("/consent/delete-account", {}, { token: bob });
check("another student cannot delete someone else's record", d1.db.prepare("SELECT COUNT(*) AS n FROM request WHERE id = ?").get(id1).n, 1);
await call("/consent/delete-account", {}, { token: alice });
check("deleting the account removes the consent record", d1.db.prepare("SELECT COUNT(*) AS n FROM request WHERE id = ?").get(id1).n, 0);

// ---------- the basics ----------
check("health check", (await call("/", null, { method: "GET" })).data.service, "trackly-consent");
check("an unknown path is not found", (await call("/consent/nope", {})).status, 404);
check("a GET on a consent path is not found", (await call("/consent/request", null, { method: "GET" })).status, 404);
const bad = await worker.fetch(new Request("https://consent.example/consent/request", { method: "POST", headers: { Origin: SITE }, body: "{broken" }), env);
check("broken data is a plain 400", bad.status, 400);
const noKey = await worker.fetch(new Request("https://consent.example/consent/request", { method: "POST", headers: { Origin: SITE }, body: "{}" }), { ...env, RESEND_API_KEY: "" });
check("missing setup is reported, not crashed", noKey.status, 500);

console.log(failed ? failed + " FAILED" : "ALL PASSED");
process.exit(failed ? 1 : 0);
