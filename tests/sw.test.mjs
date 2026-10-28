import { readFileSync } from "node:fs";
import vm from "node:vm";

let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(ok ? "PASS" : "FAIL", name, ok ? "" : "got " + JSON.stringify(got) + " want " + JSON.stringify(want));
};

const code = readFileSync(new URL("../sw.js", import.meta.url), "utf8");
check("it is a classic script (no import or export, which a service worker cannot use)", /^(import|export)\s/m.test(code), false);

// ---------- a pretend service worker world
function world({ networkDown = false } = {}) {
  const handlers = {};
  const store = new Map();            // cache name -> Map(path -> response text)
  const shown = [];
  const opened = [];
  const log = { skip: 0, claim: 0 };
  const cachesApi = {
    open: async (name) => { if (!store.has(name)) store.set(name, new Map()); const m = store.get(name); return { addAll: async (paths) => paths.forEach((p) => m.set(p, "cached:" + p)) }; },
    keys: async () => [...store.keys()],
    delete: async (name) => store.delete(name),
    match: async (req) => { const path = typeof req === "string" ? req : new URL(req.url).pathname; for (const m of store.values()) if (m.has(path)) return m.get(path); return undefined; }
  };
  const windows = [];
  const self = {
    location: { origin: "https://trackly.ng" },
    addEventListener: (type, fn) => { handlers[type] = fn; },
    skipWaiting: () => { log.skip++; return Promise.resolve(); },
    clients: { claim: () => { log.claim++; return Promise.resolve(); }, matchAll: async () => windows, openWindow: async (u) => { opened.push(u); } },
    registration: { showNotification: async (title, options) => { shown.push({ title, options }); } }
  };
  const ctx = { self, caches: cachesApi, fetch: async (r) => { if (networkDown) throw new TypeError("offline"); return "network:" + (r.url || r); }, URL, console };
  vm.runInNewContext(code, ctx);
  const fire = async (type, event) => { let p; event.waitUntil = (x) => { p = x; }; event.respondWith = (x) => { event.responded = x; }; handlers[type](event); if (p) await p; return event; };
  return { handlers, store, shown, opened, log, fire, windows };
}

// ---------- install and clean up
let w = world();
await w.fire("install", {});
check("install keeps only the offline page, its logo and its icon", [...w.store.get("trackly-offline-v1").keys()], ["/offline.html", "/assets/images/logo.webp", "/assets/images/icon-192.png"]);
check("it takes over straight away", w.log.skip, 1);
w.store.set("old-cache", new Map());
await w.fire("activate", {});
check("old copies are cleared and it claims the open pages", [[...w.store.keys()], w.log.claim], [["trackly-offline-v1"], 1]);

// ---------- pages
const nav = (url) => ({ request: { method: "GET", mode: "navigate", url } });
let ev = await w.fire("fetch", nav("https://trackly.ng/dashboard"));
check("with internet, a page comes from the internet", await ev.responded, "network:https://trackly.ng/dashboard");
w = world({ networkDown: true });
await w.fire("install", {});
ev = await w.fire("fetch", nav("https://trackly.ng/dashboard"));
check("with no internet, the offline page is shown", await ev.responded, "cached:/offline.html");
ev = await w.fire("fetch", { request: { method: "GET", mode: "cors", url: "https://trackly.ng/js/dashboard.js" } });
check("scripts are never kept: nothing answers for them", ev.responded, undefined);
ev = await w.fire("fetch", { request: { method: "POST", mode: "navigate", url: "https://trackly.ng/x" } });
check("only GET requests are touched", ev.responded, undefined);
ev = await w.fire("fetch", { request: { method: "GET", mode: "no-cors", url: "https://trackly.ng/assets/images/logo.webp" } });
check("the offline page's logo comes from memory", await ev.responded, "cached:/assets/images/logo.webp");
ev = await w.fire("fetch", { request: { method: "GET", mode: "no-cors", url: "https://other.example/assets/images/logo.webp" } });
check("another site's file is left alone", ev.responded, undefined);

// ---------- push
w = world();
await w.fire("push", { data: { json: () => ({ t: "Essay is due in 24 hours", b: "Course: Biology", u: "/assignment.html?id=a1", g: "due:a1:24" }) } });
check("a push shows a notification", [w.shown[0].title, w.shown[0].options.body, w.shown[0].options.tag, w.shown[0].options.data.url], ["Essay is due in 24 hours", "Course: Biology", "due:a1:24", "/assignment.html?id=a1"]);
check("with the Trackly icon", w.shown[0].options.icon, "/assets/images/icon-192.png");
await w.fire("push", { data: null });
check("an empty push still shows something (iPhone insists)", [w.shown[1].title, w.shown[1].options.data.url], ["Trackly", "/dashboard"]);
await w.fire("push", { data: { json: () => { throw new Error("not json"); } } });
check("a broken push still shows something", w.shown.length, 3);
await w.fire("push", { data: { json: () => ({ t: "x".repeat(500), b: 5, u: "https://evil.example/phish" }) } });
check("long titles are cut, odd values ignored, other sites refused", [w.shown[3].title.length, w.shown[3].options.body, w.shown[3].options.data.url], [140, "", "/dashboard"]);
await w.fire("push", { data: { json: () => ({ t: "x", u: "//evil.example/x" }) } });
check("a protocol relative link is refused too", w.shown[4].options.data.url, "/dashboard");

// ---------- tapping a notification
let closed = 0;
w = world();
await w.fire("notificationclick", { notification: { close: () => closed++, data: { url: "/assignment.html?id=a1" } } });
check("with Trackly closed, a tap opens it at the right page", [closed, w.opened], [1, ["/assignment.html?id=a1"]]);
w = world();
const nav2 = []; let focused = 0;
w.windows.push({ navigate: async (u) => { nav2.push(u); return { focus: () => focused++ }; }, focus: () => focused++ });
await w.fire("notificationclick", { notification: { close: () => {}, data: { url: "/courses.html" } } });
check("with Trackly open, a tap moves that window there and focuses it", [nav2, focused, w.opened], [["/courses.html"], 1, []]);
w = world();
await w.fire("notificationclick", { notification: { close: () => {}, data: { url: "https://evil.example/x" } } });
check("a tap never leaves our site", w.opened, ["/dashboard"]);

console.log(failed ? failed + " FAILED" : "ALL PASSED");
process.exit(failed ? 1 : 0);
