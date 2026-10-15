import { readFileSync, readdirSync } from "node:fs";

let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(ok ? "PASS" : "FAIL", name, ok ? "" : "got " + JSON.stringify(got) + " want " + JSON.stringify(want));
};
const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const strip = (html) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");

const pages = { "privacy.html": read("privacy.html"), "terms.html": read("terms.html") };
const text = Object.fromEntries(Object.entries(pages).map(([k, v]) => [k, strip(v)]));
const users = read("js/users.js");
const workerIndex = read("worker-calendar/index.js");
const workerLib = read("worker-calendar/lib.js");
const imageWorker = read("worker/index.js");

// ---------- the date and the version must match (new sign ups record the version)
const version = /TERMS_VERSION\s*=\s*"(\d{4})-(\d{2})-(\d{2})"/.exec(users);
const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const expected = Number(version[3]) + " " + months[Number(version[2]) - 1] + " " + version[1];
for (const [name, t] of Object.entries(text)) {
  check(name + ": last updated matches TERMS_VERSION", new RegExp("Last updated: " + expected).test(t), true);
}

// ---------- nothing left to fill in, one contact address everywhere
for (const [name, html] of Object.entries(pages)) {
  check(name + ": no yellow placeholders left", [/class="placeholder"/.test(html), /\[[A-Za-z ,@.]*(name|email)[A-Za-z ,@.]*\]/i.test(strip(html))], [false, false]);
}
const emails = new Set(Object.values(pages).flatMap((h) => h.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) || []));
check("one contact email on both pages", emails.size, 1);
check("the contact email looks valid", /^[\w.+-]+@[\w-]+\.[\w.-]+$/.test([...emails][0]), true);
check("the email is a mailto link", pages["privacy.html"].includes('href="mailto:' + [...emails][0] + '"'), true);

// ---------- structure: every contents link goes somewhere
for (const [name, html] of Object.entries(pages)) {
  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
  const tocLinks = [...html.matchAll(/<li><a href="#([^"]+)">/g)].map((m) => m[1]);
  check(name + ": 13 contents links", tocLinks.length, 13);
  check(name + ": every contents link has a section", tocLinks.filter((id) => !ids.has(id)), []);
  check(name + ": numbered sections 1 to 13", [...html.matchAll(/<h2 id="[^"]+">(\d+)\./g)].map((m) => Number(m[1])), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  check(name + ": has title, description, language, viewport", [/<title>[^<]+ \| Trackly<\/title>/.test(html), /name="description"/.test(html), /<html lang="en">/.test(html), /name="viewport"/.test(html)], [true, true, true, true]);
  check(name + ": can be found by Google", /name="robots" content="index, follow"/.test(html), true);
}
check("the privacy page has the Google section anchor", pages["privacy.html"].includes('id="google"'), true);
check("terms link to the Google section", pages["terms.html"].includes('href="privacy.html#google"'), true);
check("privacy links to the terms", pages["privacy.html"].includes('href="terms.html"'), true);
check("terms link to the privacy policy", pages["terms.html"].includes('href="privacy.html"'), true);

// ---------- what Google looks for in the privacy policy
check("Limited Use statement, word for word", text["privacy.html"].includes("Trackly's use and transfer to any other app of information received from Google APIs will adhere to the Google API Services User Data Policy, including the Limited Use requirements."), true);
for (const phrase of ["do not sell Google user data", "or use it for advertising", "do not use it to develop or train artificial intelligence models", "How to stop", "What we store, and where", "What Trackly does with it"]) {
  check("privacy says: " + phrase, text["privacy.html"].includes(phrase), true);
}

// ---------- every claim about Calendar matches the code
const scope = /const SCOPE = "([^"]+)"/.exec(workerIndex)[1];
check("the permission named in the policy is the one the Worker asks for", text["privacy.html"].includes(scope), true);
check("the Worker asks for only one permission", (workerIndex.match(/googleapis\.com\/auth\//g) || []).length, 1);
check("event title 'Due:' matches the code", workerLib.includes('"Due: "') && text["privacy.html"].includes('"Due:"'), true);
check("event title 'Work on:' matches the code", workerLib.includes('"Work on: "') && text["privacy.html"].includes('"Work on:"'), true);
check("daily reminder hour in the policy matches the code", /DAILY_HOUR = 8/.test(read("js/reminders.js")) && text["privacy.html"].includes("8:00"), true);
check("the token really is encrypted (AES-GCM)", workerLib.includes("AES-GCM") && text["privacy.html"].includes("encrypted"), true);
check("the token really is kept in Cloudflare KV, not Firestore", /env\.CALENDAR\.put\("tok:"/.test(workerIndex) && !/refresh/i.test(read("js/calendar-store.js")), true);
check("a tag is checked before an event is deleted", workerIndex.includes("trackly === \"1\"") && text["privacy.html"].includes("checks the tag"), true);
check("disconnect revokes access at Google", workerIndex.includes("oauth2.googleapis.com/revoke") && text["privacy.html"].includes("takes back its permission from Google"), true);

// ---------- providers named are the ones really used
check("photo search provider is Pixabay in the code", imageWorker.includes("pixabay.com"), true);
for (const [name, t] of Object.entries(text)) {
  check(name + ": names Pixabay, not Pexels", [t.includes("Pixabay"), /Pexels/i.test(t)], [true, false]);
  check(name + ": names Cloudinary and Cloudflare and Firebase", ["Cloudinary", "Cloudflare", "Firebase"].every((w) => t.includes(w)), true);
}

// ---------- statements about the app that must stay true
const appFiles = readdirSync(new URL("../js/", import.meta.url)).filter((f) => f.endsWith(".js")).map((f) => read("js/" + f));
const htmlFiles = readdirSync(new URL("../", import.meta.url)).filter((f) => f.endsWith(".html")).map((f) => read(f));
const analytics = /gtag\(|googletagmanager|google-analytics|firebase\/analytics|getAnalytics|mixpanel|hotjar|segment\.com/i;
check("the policy says no third-party analytics, and there is none in the code", [text["privacy.html"].includes("third-party analytics tools"), [...appFiles, ...htmlFiles].some((f) => analytics.test(f))], [true, false]);
check("age rule is 18 and over, or with permission, on both pages", Object.values(text).every((t) => t.includes("aged 18 and over") && t.includes("parent or guardian")), true);
check("deletion takes 30 days on both pages", Object.values(text).every((t) => t.includes("within 30 days")), true);
check("governing law is Nigeria", text["terms.html"].includes("laws of the Federal Republic of Nigeria"), true);
check("reminders are not promised as a guarantee", /not a guarantee/.test(text["terms.html"]), true);

// ---------- house style
for (const [name, html] of Object.entries(pages)) {
  check(name + ": no long dashes", /[\u2013\u2014]/.test(html), false);
}

console.log(failed ? failed + " FAILED" : "ALL PASSED");
process.exit(failed ? 1 : 0);
