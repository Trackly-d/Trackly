import { webcrypto } from "node:crypto";
import worker from "../worker/index.js";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(ok ? "PASS" : "FAIL", name, ok ? "" : "got " + JSON.stringify(got) + " want " + JSON.stringify(want));
};

const enc = new TextEncoder();
const b64u = (bytes) => Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const PROJECT = "trackly-e18d8";
const SITE = "http://localhost:5500";
const JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const CLOUD = "https://api.cloudinary.com/v1_1/democloud/resources/image/upload";

const algo = { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" };
const pair = await crypto.subtle.generateKey(algo, true, ["sign", "verify"]);
const other = await crypto.subtle.generateKey(algo, true, ["sign", "verify"]);
const jwk = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid: "k1", alg: "RS256", use: "sig" };

async function token(claims = {}, key = pair.privateKey) {
  const s = Math.floor(Date.now() / 1000);
  const head = b64u(enc.encode(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" })));
  const body = b64u(enc.encode(JSON.stringify({ aud: PROJECT, iss: "https://securetoken.google.com/" + PROJECT, sub: "student-1", iat: s - 10, exp: s + 3600, ...claims })));
  return head + "." + body + "." + b64u(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(head + "." + body)));
}

const calls = [];
let cloudinary = (ids) => ({ status: 200, body: { deleted: Object.fromEntries(ids.map((id) => [id, "deleted"])) } });
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  calls.push({ url, ...init });
  if (url === JWKS_URL) return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
  if (url === CLOUD) {
    if (cloudinary instanceof Error) throw cloudinary;
    const ids = new URLSearchParams(init.body).getAll("public_ids[]");
    const out = cloudinary(ids);
    return new Response(JSON.stringify(out.body), { status: out.status });
  }
  return new Response("{}", { status: 404 });
};

const env = { FIREBASE_PROJECT_ID: PROJECT, CLOUDINARY_CLOUD_NAME: "democloud", CLOUDINARY_API_KEY: "KEY123", CLOUDINARY_API_SECRET: "SECRET456", ALLOWED_ORIGINS: SITE };

async function call(method, body, { origin = SITE, auth, e = env, raw } = {}) {
  const headers = {};
  if (origin) headers.Origin = origin;
  if (auth) headers.Authorization = "Bearer " + auth;
  const res = await worker.fetch(new Request("https://images.example/images/delete", { method, headers, body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body) }), e);
  const text = await res.text();
  let data = null; try { data = JSON.parse(text); } catch (err) { /* not json */ }
  return { status: res.status, data, text, headers: res.headers };
}

// ---------- who may call
let r = await call("OPTIONS");
check("preflight allows POST and the sign in header", [r.status, r.headers.get("Access-Control-Allow-Methods").includes("POST"), r.headers.get("Access-Control-Allow-Headers").includes("Authorization")], [204, true, true]);
r = await call("POST", { publicIds: ["a/b"] });
check("no sign in is refused", [r.status, r.data.error], [401, "sign_in_needed"]);
r = await call("POST", { publicIds: ["a/b"] }, { auth: await token({}, other.privateKey) });
check("a forged sign in is refused", r.status, 401);
r = await call("POST", { publicIds: ["a/b"] }, { auth: await token({ aud: "another-app" }) });
check("a sign in for another project is refused", r.status, 401);
r = await call("POST", { publicIds: ["a/b"] }, { auth: await token({ exp: Math.floor(Date.now() / 1000) - 5 }) });
check("an expired sign in is refused", r.status, 401);
r = await call("POST", { publicIds: ["a/b"] }, { auth: await token(), origin: "https://evil.example" });
check("another website is refused", r.status, 403);
check("nothing reached Cloudinary so far", calls.filter((c) => c.url === CLOUD).length, 0);
r = await call("POST", { publicIds: ["a/b"] }, { auth: await token(), e: { ...env, CLOUDINARY_API_SECRET: "" } });
check("missing secret says not configured", [r.status, r.data.error], [500, "not_configured"]);
r = await call("POST", { publicIds: ["a/b"] }, { auth: await token(), e: { ...env, FIREBASE_PROJECT_ID: "" } });
check("missing project says not configured", r.data.error, "not_configured");

// ---------- the delete itself
const good = await token();
calls.length = 0;
r = await call("POST", { publicIds: ["trackly/one", "trackly/two"] }, { auth: good });
check("two deleted", [r.status, r.data], [200, { deleted: 2, notFound: 0, requested: 2 }]);
const sent = calls.find((c) => c.url === CLOUD);
check("goes to Cloudinary as a DELETE", sent.method, "DELETE");
check("signed with the key and secret (Basic)", sent.headers.Authorization, "Basic " + Buffer.from("KEY123:SECRET456").toString("base64"));
check("sends exactly the ids asked for", new URLSearchParams(sent.body).getAll("public_ids[]"), ["trackly/one", "trackly/two"]);
check("the secret never comes back to the website", r.text.includes("SECRET456") || r.text.includes("KEY123"), false);

cloudinary = (ids) => ({ status: 200, body: { deleted: { [ids[0]]: "deleted", [ids[1]]: "not_found" } } });
r = await call("POST", { publicIds: ["a", "b"] }, { auth: good });
check("a photo already gone counts separately", r.data, { deleted: 1, notFound: 1, requested: 2 });

// ---------- what may be asked
calls.length = 0;
cloudinary = (ids) => ({ status: 200, body: { deleted: Object.fromEntries(ids.map((id) => [id, "deleted"])) } });
for (const [label, body] of [
  ["no list", {}],
  ["not a list", { publicIds: "a/b" }],
  ["empty list", { publicIds: [] }],
  ["51 ids", { publicIds: Array.from({ length: 51 }, (_, i) => "id" + i) }],
  ["a trick path", { publicIds: ["a/../b"] }],
  ["a leading slash", { publicIds: ["/etc/x"] }],
  ["odd characters", { publicIds: ["a b"] }],
  ["a number", { publicIds: [5] }],
  ["too long an id", { publicIds: ["x".repeat(201)] }]
]) {
  const x = await call("POST", body, { auth: good });
  check("refused: " + label, [x.status, x.data.error], [400, "bad_request"]);
}
r = await call("POST", undefined, { auth: good, raw: "{broken" });
check("refused: broken json", [r.status, r.data.error], [400, "bad_request"]);
r = await call("POST", undefined, { auth: good, raw: JSON.stringify({ publicIds: ["a"], pad: "x".repeat(9000) }) });
check("refused: too big a message", [r.status, r.data.error], [413, "too_big"]);
check("50 ids are fine", (await call("POST", { publicIds: Array.from({ length: 50 }, (_, i) => "id" + i) }, { auth: good })).status, 200);
check("none of the refused calls reached Cloudinary", calls.filter((c) => c.url === CLOUD).length, 1);

// ---------- the optional folder lock
const locked = { ...env, IMAGE_FOLDER_PREFIX: "trackly/" };
r = await call("POST", { publicIds: ["other/x"] }, { auth: good, e: locked });
check("outside the folder is refused", [r.status, r.data.error], [400, "bad_request"]);
check("inside the folder is fine", (await call("POST", { publicIds: ["trackly/x"] }, { auth: good, e: locked })).status, 200);

// ---------- when Cloudinary has a problem
cloudinary = () => ({ status: 500, body: { error: "boom" } });
r = await call("POST", { publicIds: ["a"] }, { auth: good });
check("Cloudinary error gives a clear 502", [r.status, r.data.error], [502, "cloudinary"]);
cloudinary = new Error("network down");
r = await call("POST", { publicIds: ["a"] }, { auth: good });
check("Cloudinary unreachable gives a clear 502", [r.status, r.data.error], [502, "cloudinary"]);

// ---------- the old behaviour is untouched
r = await worker.fetch(new Request("https://images.example/", { method: "GET" }), env);
check("the normal health answer still works", (await r.json()).service, "trackly-images");

console.log(failed ? failed + " FAILED" : "ALL PASSED");
process.exit(failed ? 1 : 0);
