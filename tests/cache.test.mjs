// pretend session storage
const data = new Map();
globalThis.window = {
  sessionStorage: {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, v); },
    removeItem: (k) => { data.delete(k); },
    key: (i) => Array.from(data.keys())[i],
    get length() { return data.size; }
  }
};
let clock = 1_000_000;
Date.now = () => clock;

const { cached, readCache, writeCache, invalidateCache, clearAllCache } = await import("../js/cache.js");
let failed = 0;
const check = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) failed++; console.log(ok ? "PASS" : "FAIL", name, ok ? "" : "got " + JSON.stringify(got) + " want " + JSON.stringify(want)); };

let calls = 0;
const loader = async () => { calls += 1; return { n: calls, list: [1, 2, 3] }; };

check("first time asks the database", [(await cached("u1", "counts", 60000, loader)).n, calls], [1, 1]);
check("second time uses the memory", [(await cached("u1", "counts", 60000, loader)).n, calls], [1, 1]);
clock += 59_000;
check("still fresh after 59 seconds", [(await cached("u1", "counts", 60000, loader)).n, calls], [1, 1]);
clock += 2_000;
check("asks again after it goes stale", [(await cached("u1", "counts", 60000, loader)).n, calls], [2, 2]);

check("a different student has their own memory", [(await cached("u2", "counts", 60000, loader)).n, calls], [3, 3]);
check("a different key is separate", [(await cached("u1", "lists", 60000, loader)).n, calls], [4, 4]);

invalidateCache("u1");
check("invalidate clears that student only", [readCache("u1", "counts", 60000), readCache("u1", "lists", 60000), readCache("u2", "counts", 60000) !== null], [null, null, true]);
check("after invalidate the database is asked again", [(await cached("u1", "counts", 60000, loader)).n, calls], [5, 5]);

clearAllCache();
check("clear all removes everyone", [readCache("u1", "counts", 60000), readCache("u2", "counts", 60000), data.size], [null, null, 0]);

data.set("unrelated", "keep me");
writeCache("u1", "x", { a: 1 });
clearAllCache();
check("other stored things are left alone", [data.get("unrelated"), readCache("u1", "x", 60000)], ["keep me", null]);

data.set("trackly:v1:u1:broken", "{not json");
check("broken stored text is treated as empty", readCache("u1", "broken", 60000), null);

// storage blocked: falls back to memory
Object.defineProperty(globalThis.window, "sessionStorage", { get() { throw new Error("blocked"); } });
calls = 0;
check("works with storage blocked (in memory)", [(await cached("u9", "k", 60000, loader)).n, (await cached("u9", "k", 60000, loader)).n, calls], [1, 1, 1]);
invalidateCache("u9");
check("invalidate works in memory too", readCache("u9", "k", 60000), null);

console.log(failed ? failed + " FAILED" : "ALL PASSED");
