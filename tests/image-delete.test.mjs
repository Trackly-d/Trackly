import { publicIdFromUrl, collectImageIds, createImageDeleter, ImageDeleteError } from "../js/image-delete.js";

let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(ok ? "PASS" : "FAIL", name, ok ? "" : "got " + JSON.stringify(got) + " want " + JSON.stringify(want));
};

const U = (path) => "https://res.cloudinary.com/demo/image/upload/" + path;
check("with version and folder", publicIdFromUrl(U("v1699999999/trackly/abc123.jpg")), "trackly/abc123");
check("without folder", publicIdFromUrl(U("v12/abc123.png")), "abc123");
check("without version", publicIdFromUrl(U("trackly/abc123.webp")), "trackly/abc123");
check("with a transformation in front", publicIdFromUrl(U("c_fill,w_300/v5/trackly/abc.jpg")), "trackly/abc");
check("query string ignored", publicIdFromUrl(U("v1/trackly/abc.jpg?x=1")), "trackly/abc");
check("a Google photo is not ours", publicIdFromUrl("https://lh3.googleusercontent.com/a/abc=s96-c"), "");
check("a Pixabay photo is not ours", publicIdFromUrl("https://pixabay.com/get/p1_1280.jpg"), "");
check("empty and junk", [publicIdFromUrl(""), publicIdFromUrl(null), publicIdFromUrl("not a url")], ["", "", ""]);
check("a trick path is refused", publicIdFromUrl(U("v1/../secret.jpg")), "");

check("ids from courses and the profile photo", collectImageIds({ courses: [{ imagePublicId: "c/one" }, { imagePublicId: "" }, {}, { imagePublicId: "c/two" }], customPhotoURL: U("v1/p/me.jpg") }), ["c/one", "c/two", "p/me"]);
check("a saved profile photo id wins over the address", collectImageIds({ customPhotoPublicId: "p/saved", customPhotoURL: U("v1/p/other.jpg") }), ["p/saved"]);
check("no duplicates", collectImageIds({ courses: [{ imagePublicId: "a" }, { imagePublicId: "a" }], customPhotoPublicId: "a" }), ["a"]);
check("a Google photo adds nothing", collectImageIds({ customPhotoURL: "https://lh3.googleusercontent.com/a/x" }), []);
check("nothing at all", collectImageIds({}), []);
check("odd ids are dropped", collectImageIds({ courses: [{ imagePublicId: "../x" }, { imagePublicId: "ok/id" }] }), ["ok/id"]);

// ---------- the client
const calls = [];
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
const make = (handler, extra = {}) => { calls.length = 0; return createImageDeleter({ workerUrl: "https://images.example/", getToken: async () => "TOKEN", fetchFn: async (url, init) => { calls.push({ url, ...init }); return handler(JSON.parse(init.body), init); }, ...extra }); };
const fails = async (p) => { try { await p; return null; } catch (e) { return e; } };

let d = make((b) => json({ deleted: b.publicIds.length, notFound: 0 }));
check("deletes and counts", await d.deleteImages(["a", "b"]), 2);
check("request shape", [calls[0].url, calls[0].method, calls[0].headers.Authorization, JSON.parse(calls[0].body)], ["https://images.example/images/delete", "POST", "Bearer TOKEN", { publicIds: ["a", "b"] }]);
check("no ids, no call", [await make(() => json({})).deleteImages([]), calls.length], [0, 0]);
check("duplicates sent once", (await make((b) => json({ deleted: b.publicIds.length })).deleteImages(["a", "a", "b"]), JSON.parse(calls[0].body).publicIds), ["a", "b"]);
const many = Array.from({ length: 120 }, (_, i) => "id" + i);
d = make((b) => json({ deleted: b.publicIds.length - 1, notFound: 1 }));
check("sent 50 at a time, not found counts as gone", [await d.deleteImages(many), calls.map((c) => JSON.parse(c.body).publicIds.length)], [120, [50, 50, 20]]);
check("not set up", (await fails(createImageDeleter({ workerUrl: "", getToken: async () => "t" }).deleteImages(["a"]))).code, "not_configured");
check("worker error code kept", (await fails(make(() => json({ error: "sign_in_needed" }, 401)).deleteImages(["a"]))).code, "sign_in_needed");
check("a broken answer", (await fails(make(() => new Response("oops", { status: 500 })).deleteImages(["a"]))).code, "photos");
check("no network", (await fails(make(() => { throw new TypeError("Failed to fetch"); }).deleteImages(["a"]))).code, "network");
check("signed out", (await fails(make(() => json({}), { getToken: async () => { throw new Error("x"); } }).deleteImages(["a"]))).code, "sign_in_needed");
d = createImageDeleter({ workerUrl: "https://i.example", getToken: async () => "t", timeoutMs: 20, fetchFn: (u, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(Object.assign(new Error("a"), { name: "AbortError" })))) });
check("a slow Worker times out", (await fails(d.deleteImages(["a"]))).code, "timeout");
check("errors are ImageDeleteError", (await fails(make(() => json({ error: "x" }, 400)).deleteImages(["a"]))) instanceof ImageDeleteError, true);

console.log(failed ? failed + " FAILED" : "ALL PASSED");
process.exit(failed ? 1 : 0);
