import { readdirSync, readFileSync } from "node:fs";
import { DELETE_COLLECTIONS, CONFIRM_WORD, AccountDeleteError, validateDeleteForm, deleteAccount, deleteMessage } from "../js/account-delete.js";

let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(ok ? "PASS" : "FAIL", name, ok ? "" : "got " + JSON.stringify(got) + " want " + JSON.stringify(want));
};

// ---------- the form
check("password account needs the password", validateDeleteForm({ typed: "DELETE", password: "" }, "change").field, "password");
check("Google account needs no password", validateDeleteForm({ typed: "DELETE" }, "set").ok, true);
check("must type the word", validateDeleteForm({ typed: "delete", password: "x" }, "change").field, "typed");
check("the word with spaces around it is fine", validateDeleteForm({ typed: "  DELETE ", password: "x" }, "change").ok, true);
check("nothing typed", validateDeleteForm({ typed: "", password: "x" }, "change").error.includes(CONFIRM_WORD), true);

// ---------- the steps
function run(overrides = {}) {
  const log = [];
  const step = (name) => async () => { log.push(name); };
  const deps = { reauth: step("reauth"), removeCalendar: step("calendar"), removePush: step("push"), removeConsent: step("consent"), removePhotos: step("photos"), removeData: step("data"), removeLogin: step("login"), ...overrides };
  const progress = [];
  const promise = deleteAccount({ deps, onProgress: (text, n, total) => progress.push([n, total]) });
  return { log, progress, promise };
}
const err = (code) => Object.assign(new Error(code), { code });

let r = run();
check("all steps in order, the login last", [(await r.promise).ok, r.log], [true, ["reauth", "calendar", "push", "consent", "photos", "data", "login"]]);
check("progress is reported for every step", r.progress, [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7], [6, 7], [7, 7]]);

r = run({ reauth: async () => { throw err("auth/wrong-password"); } });
let e = await r.promise.catch((x) => x);
check("a wrong password stops everything before anything is deleted", [e instanceof AccountDeleteError, e.step, r.log], [true, "reauth", []]);

r = run({ removeCalendar: async () => { throw err("reconnect"); } });
check("Calendar needing a reconnect does not block (nothing more can be removed)", [await r.promise.then((x) => x.ok, () => false), r.log.includes("login")], [true, true]);
r = run({ removeCalendar: async () => { throw err("not_connected"); } });
check("Calendar not connected does not block", await r.promise.then((x) => x.ok, () => false), true);
r = run({ removeCalendar: async () => { throw err("network"); } });
e = await r.promise.catch((x) => x);
check("a Calendar network problem stops it, before photos or data go", [e.step, r.log], ["calendar", ["reauth"]]);

r = run({ removePush: async () => { throw err("network"); } });
e = await r.promise.catch((x) => x);
check("a push problem stops it, before photos or data go", [e.step, r.log], ["push", ["reauth", "calendar"]]);

r = run({ removePhotos: async () => { throw err("network"); } });
e = await r.promise.catch((x) => x);
check("photos failing stops it, data and login are untouched", [e.step, r.log.includes("data"), r.log.includes("login")], ["photos", false, false]);
r = run({ removeConsent: async () => { throw err("network"); } });
e = await r.promise.catch((x) => x);
check("a consent problem stops it, before photos or data go", [e.step, r.log], ["consent", ["reauth", "calendar", "push"]]);
r = run({ removeData: async () => { throw err("x"); } });
e = await r.promise.catch((x) => x);
check("data failing keeps the login", [e.step, r.log.includes("login")], ["data", false]);
r = run({ removeLogin: async () => { throw err("auth/requires-recent-login"); } });
e = await r.promise.catch((x) => x);
check("the login failing is reported as the last step", e.step, "login");

// ---------- the sentences
const msg = (step, code) => deleteMessage(new AccountDeleteError(step, err(code)));
check("wrong password", msg("reauth", "auth/invalid-credential"), "Your current password is not right.");
check("closing the Google window says nothing", msg("reauth", "auth/popup-closed-by-user"), "");
check("calendar", msg("calendar", "network").includes("Google Calendar reminders"), true);
check("photos", msg("photos", "network").includes("photos"), true);
check("push", msg("push", "network").includes("push notifications"), true);
check("consent", msg("consent", "network").includes("consent record"), true);
check("data", msg("data", "x").includes("data"), true);
check("login says the data is already gone", msg("login", "x").includes("Your data is deleted"), true);
check("unknown", deleteMessage(new Error("?")).length > 5, true);

// ---------- the list of collections must cover everything the app saves for a student
const here = new URL("../js/", import.meta.url);
const used = new Set();
for (const f of readdirSync(here).filter((n) => n.endsWith(".js"))) {
  const text = readFileSync(new URL(f, here), "utf8");
  for (const m of text.matchAll(/"users",\s*[A-Za-z_.]+,\s*"([A-Za-z]+)"/g)) used.add(m[1]);
}
check("the code saves these collections under a student", [...used].sort(), ["assignments", "calendarCleanup", "courses", "notifications"]);
check("account deletion covers every one of them", [...used].filter((c) => !DELETE_COLLECTIONS.includes(c)), []);
check("and lists nothing the app does not use", DELETE_COLLECTIONS.filter((c) => !used.has(c)), []);

console.log(failed ? failed + " FAILED" : "ALL PASSED");
process.exit(failed ? 1 : 0);
