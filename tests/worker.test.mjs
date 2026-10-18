import worker, { buildQuery } from "../worker/index.js";

let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(ok ? "PASS" : "FAIL", name, ok ? "" : "got " + JSON.stringify(got) + " want " + JSON.stringify(want));
};

// ----- buildQuery
const q = (t) => buildQuery(t);
check("biology", q("Introduction to Biology"), "biology laboratory microscope");
check("organic chem", q("Organic Chemistry"), "chemistry laboratory glassware");
check("data structures", q("Data Structures & Algorithms"), "computer programming code laptop");
check("statistics before math", q("Statistics & Probability"), "statistics data charts");
check("microeconomics", q("Microeconomics"), "economics finance charts");
check("use of english", q("GST 111 Use of English"), "english literature books");
check("math", q("MTH 101 Calculus I"), "mathematics equations chalkboard");
check("computer engineering -> computer first", q("Computer Engineering"), "computer programming code laptop");
check("unknown subject uses cleaned words", q("Peace and Conflict Resolution"), "peace conflict resolution");
check("only filler -> fallback", q("Introduction to the"), "students studying books");
check("no false match on 'part' (art)", q("Part time work"), "time work");
check("macroeconomics problem set", q("Macroeconomics Problem Set"), "economics finance charts");
check("technological is not philosophy", q("Technological Innovation"), "technological innovation");
check("biochemistry", q("Biochemistry"), "biology laboratory microscope");

// ----- fake Pixabay + KV
const hit = (n) => ({ id: n, webformatURL: "https://pixabay.com/get/p" + n + "_640.jpg", largeImageURL: "https://pixabay.com/get/p" + n + "_1280.jpg", user: "user" + n, pageURL: "https://pixabay.com/photos/" + n });
let calls = [];
let mode = "hits";
globalThis.fetch = async (u) => {
  const url = new URL(u);
  calls.push(url.searchParams.get("q"));
  if (mode === "429") return new Response("slow down", { status: 429 });
  if (mode === "empty-then-hits") {
    return new Response(JSON.stringify({ hits: url.searchParams.get("q") === "students studying books" ? [hit(1)] : [] }), { status: 200 });
  }
  return new Response(JSON.stringify({ hits: [1, 2, 3, 4, 5, 6, 7, 8].map(hit) }), { status: 200 });
};
const store = new Map();
const kv = { get: async (k) => (store.has(k) ? JSON.parse(store.get(k)) : null), put: async (k, v) => { store.set(k, v); } };
const env = { PIXABAY_KEY: "secret-key", CACHE: kv };
const ask = (path, opts = {}, e = env) => worker.fetch(new Request("https://w.example" + path, opts), e);

// ----- requests
let r = await ask("/images?q=Introduction%20to%20Biology", { headers: { Origin: "http://127.0.0.1:5500" } });
let body = await r.json();
check("status 200", r.status, 200);
check("cors header", r.headers.get("Access-Control-Allow-Origin"), "http://127.0.0.1:5500");
check("6 results max", body.results.length, 6);
check("result shape", Object.keys(body.results[0]), ["id", "preview", "full", "user", "pageUrl"]);
check("used the better query", calls[0], "biology laboratory microscope");
check("key is NOT in the answer", JSON.stringify(body).includes("secret-key"), false);

const callsBefore = calls.length;
r = await ask("/images?q=General%20Biology", { headers: { Origin: "http://127.0.0.1:5500" } });
body = await r.json();
check("second similar title is served from cache", [body.cached, calls.length], [true, callsBefore]);

r = await ask("/images?q=Biology", { headers: { Origin: "https://evil.example" } });
check("other website blocked", r.status, 403);
r = await ask("/images?q=Biology");
check("no Origin (typing the URL in a browser) works", r.status, 200);
r = await ask("/images?q=a");
check("too short title", r.status, 400);
r = await ask("/images?q=" + "x".repeat(81));
check("too long title", r.status, 400);
r = await ask("/images?q=Biology", {}, { CACHE: kv });
check("missing key -> clear error", r.status, 500);
r = await ask("/images?q=Biology", { method: "OPTIONS", headers: { Origin: "https://trackly.ng" } });
check("preflight", [r.status, r.headers.get("Access-Control-Allow-Methods")], [204, "GET, POST, OPTIONS"]);

mode = "empty-then-hits"; calls = [];
r = await ask("/images?q=Peace%20Studies", {}, { PIXABAY_KEY: "k" });
body = await r.json();
check("fallback search when nothing found", [body.query, body.results.length, calls], ["students studying books", 1, ["peace studies", "students studying books"]]);

mode = "429";
r = await ask("/images?q=Chemistry", {}, { PIXABAY_KEY: "k" });
check("rate limit passed on clearly", r.status, 429);

r = await ask("/");
check("home answers", (await r.json()).service, "trackly-images");
console.log(failed ? failed + " FAILED" : "ALL PASSED");
