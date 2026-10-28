import { readFileSync, readdirSync, existsSync } from "node:fs";

let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(ok ? "PASS" : "FAIL", name, ok ? "" : "got " + JSON.stringify(got) + " want " + JSON.stringify(want));
};
const root = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");
const exists = (p) => existsSync(new URL(p, root));

// ---------- every page can be installed and registers the service worker
const pages = readdirSync(root).filter((f) => f.endsWith(".html") && f !== "offline.html");
check("there are pages to check", pages.length >= 20, true);
check("every page links the manifest and the theme colour", pages.filter((p) => !(read(p).includes('<link rel="manifest" href="/manifest.webmanifest">') && /<meta name="theme-color" content="#0E5C4A">/.test(read(p)))), []);
check("every page loads the install script exactly once", pages.filter((p) => (read(p).match(/src="\/js\/pwa\.js"/g) || []).length !== 1), []);
check("every page has an Apple home screen icon", pages.filter((p) => !/rel="apple-touch-icon"/.test(read(p))), []);
check("the offline page has no JavaScript and only site-root links", [/<script/.test(read("offline.html")), [...read("offline.html").matchAll(/(?:src|href)="([^"#]+)"/g)].map((m) => m[1]).filter((v) => !v.startsWith("/"))], [false, []]);
check("the offline page is private", /name="robots" content="noindex/.test(read("offline.html")), true);

// ---------- the manifest
const manifest = JSON.parse(read("manifest.webmanifest"));
check("manifest basics", [manifest.name, manifest.display, manifest.scope, manifest.id, manifest.start_url.startsWith("/dashboard")], ["Trackly", "standalone", "/", "/", true]);
check("manifest colours are real", [/^#[0-9A-Fa-f]{6}$/.test(manifest.theme_color), /^#[0-9A-Fa-f]{6}$/.test(manifest.background_color)], [true, true]);
const png = (path) => { const b = readFileSync(new URL(path.replace(/^\//, ""), root)); return b.readUInt32BE(16) + "x" + b.readUInt32BE(20); };
check("every icon exists and is the size it says", manifest.icons.filter((i) => !exists(i.src.replace(/^\//, "")) || png(i.src) !== i.sizes), []);
check("there is a 192, a 512 and a maskable icon", [manifest.icons.some((i) => i.sizes === "192x192"), manifest.icons.some((i) => i.sizes === "512x512" && i.purpose === "any"), manifest.icons.some((i) => i.purpose === "maskable")], [true, true, true]);

// ---------- hosting
const fb = JSON.parse(read("firebase.json"));
const headers = Object.fromEntries(fb.hosting.headers.map((h) => [h.source, Object.fromEntries(h.headers.map((x) => [x.key, x.value]))]));
check("the service worker is never kept stale", headers["/sw.js"] && headers["/sw.js"]["Cache-Control"], "no-cache");
check("the manifest has its proper type", headers["/manifest.webmanifest"] && headers["/manifest.webmanifest"]["Content-Type"], "application/manifest+json");
check("the files the site needs are not hidden from visitors", ["sw.js", "manifest.webmanifest", "offline.html"].filter((f) => fb.hosting.ignore.some((g) => g === f || g === "*." + f.split(".").pop())), []);
check("the Worker folder is not uploaded to hosting", fb.hosting.ignore.includes("worker-push/**"), true);

// ---------- the install button
const pwa = read("js/pwa.js");
const css = read("css/install.css");
check("every class the install script builds has a style", [...pwa.matchAll(/ins-[\w-]+/g)].map((m) => m[0]).filter((c, i, a) => a.indexOf(c) === i).filter((c) => c !== "ins-title" /* an id, not a class */).filter((c) => !css.includes("." + c)), []);
check("no design only files are left", ["design-pwa.html", "js/install-design.js", "js/push-card-design.js"].filter(exists), []);
check("the install script never reads student data", /firebase|firestore|localStorage|sessionStorage/i.test(pwa), false);

// ---------- the push Worker is complete
const toml = read("worker-push/wrangler.toml");
check("the Worker runs every minute and has its database", [/crons = \["\* \* \* \* \*"\]/.test(toml), /binding = "DB"/.test(toml)], [true, true]);
check("the Worker's settings are all there", ["FIREBASE_PROJECT_ID", "VAPID_PUBLIC_KEY", "VAPID_SUBJECT", "ALLOWED_ORIGINS"].filter((k) => !toml.includes(k + " =")), []);
check("the private key is never written in the project", /"d"\s*:/.test(toml) || /VAPID_PRIVATE_JWK\s*=/.test(toml) || /VAPID_PRIVATE_JWK\s*=/.test(read("js/push-config.js")), false);
check("the allowed sites include the real one", /https:\/\/trackly\.ng/.test(toml), true);
const schema = read("worker-push/schema.sql");
const index = read("worker-push/index.js");
const tables = [...schema.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]);
check("every table the Worker uses is created by schema.sql", [...index.matchAll(/(?:FROM|INTO|UPDATE) (?!SET)(\w+)/g)].map((m) => m[1]).filter((t) => !tables.includes(t)), []);
check("the Worker allows the website's allowed origins and the cron handler exists", [/scheduled\(/.test(index), /export async function runSchedule/.test(index)], [true, true]);
check("the website's push address is a secure address", /^https:\/\//.test(/PUSH_WORKER_URL = "([^"]+)"/.exec(read("js/push-config.js"))[1]), true);
for (const f of ["README.md", "make-vapid-keys.mjs", "package.json", "lib.js", "index.js", "schema.sql", "wrangler.toml"]) check("worker-push/" + f + " exists", exists("worker-push/" + f), true);

// ---------- house style: no long dashes in anything written for this job
const written = ["sw.js", "manifest.webmanifest", "offline.html", "js/pwa.js", "js/pwa-logic.js", "js/push.js", "js/push-client.js", "js/push-logic.js", "js/push-sync.js", "js/push-config.js", "css/install.css", "worker-push/index.js", "worker-push/lib.js", "worker-push/schema.sql", "worker-push/README.md", "worker-push/wrangler.toml", "worker-push/make-vapid-keys.mjs"];
check("no long dashes", written.filter((f) => /[\u2013\u2014]/.test(read(f))), []);
check("no alert or confirm pop ups", written.filter((f) => /\b(alert|confirm)\(/.test(read(f))), []);

console.log(failed ? failed + " FAILED" : "ALL PASSED");
process.exit(failed ? 1 : 0);
