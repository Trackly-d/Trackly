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

// ---------- every element a script looks for is on its page
const pairs = [["js/who-are-you.js", "who-are-you.html"], ["js/parental-consent.js", "parental-consent.html"], ["js/parent-approval.js", "parent-approval.html"]];
for (const [js, html] of pairs) {
  const code = read(js), page = read(html);
  const ids = [...new Set([...code.matchAll(/(?:\$|getElementById)\("([\w-]+)"\)/g)].map((m) => m[1]))];
  check(js + ": every id it uses is on " + html, ids.filter((i) => i !== "wy-note" /* made by the script on purpose */).filter((i) => !new RegExp('id="' + i + '"').test(page)), []);
  check(html + " loads its script", page.includes('src="js/' + js.split("/")[1] + '"'), true);
  check(html + ": no design preview is left", [/Design preview/.test(page), /consent-design/.test(page), /data-states=/.test(page)], [false, false, false]);
}

// ---------- the card views the scripts choose all exist in the page and in the style sheet
const css = read("css/consent.css");
for (const [js, html, viewsOf] of [["js/parental-consent.js", "parental-consent.html", ["form", "sent", "approved", "declined", "expired"]], ["js/parent-approval.js", "parent-approval.html", ["loading", "ready", "approved", "declined", "expired"]]]) {
  const page = read(html);
  check(html + ": every view has its markup and its style", viewsOf.filter((v) => !page.includes("cs-v-" + v) || !css.includes('data-view="' + v + '"')), []);
}
check("the parent's page starts on the loading view, so an expired link never flashes the buttons", /id="pa-card" data-view="loading"/.test(read("parent-approval.html")), true);
check("the parent's page tells browsers not to share the link address with other sites", /<meta name="referrer" content="no-referrer">/.test(read("parent-approval.html")), true);
check("both account screens are private", pairs.concat([["", "who-are-you.html"]]).every(([, h]) => /noindex/.test(read(h))), true);

// ---------- the journey is wired
const who = read("who-are-you.html");
check("Who are you? has both choices", [/data-level="higher"/.test(who), /data-level="secondary"/.test(who)], [true, true]);
check("there is no way to skip the parent step from the consent screen", [/Sign up directly/i.test(read("parental-consent.html")), /href="signup\.html"[^>]*>(?!Continue)/.test(read("parental-consent.html").replace(/<a class="cs-btn" id="pc-continue"[^>]*>/, ""))], [false, false]);
const outside = readdirSync(root).filter((f) => f.endsWith(".html") && !["who-are-you.html", "parental-consent.html", "signup.html"].includes(f) && /href="signup\.html"/.test(read(f)));
check("no other page sends people straight to sign up", outside, []);
check("sign up refuses people who skipped Who are you?", /signupGate\(/.test(read("js/signup-page.js")) && /levelFor/.test(read("js/signup-page.js")), true);
check("the account is removed again if the approval cannot be used", /removeNewAccount\(cred\.user\)/.test(read("js/auth.js")) && /removeNewAccount\(cred\.user\)[\s\S]*throw err/.test(read("js/auth.js")), true);
check("a new Google account is marked until it answers Who are you?", /levelPending: true/.test(read("js/auth.js")) && /levelGate\(user\)/.test(read("js/auth.js")), true);
check("the login page sends a new Google account to finish", /who-are-you\.html\?finish=1/.test(read("js/login-page.js")), true);
check("deleting an account also deletes the consent record", /removeConsent/.test(read("js/settings.js")) && /removeConsent/.test(read("js/account-delete.js")), true);

// ---------- the consent Worker
const toml = read("worker-consent/wrangler.toml");
const index = read("worker-consent/index.js");
const schema = read("worker-consent/schema.sql");
for (const f of ["README.md", "package.json", "lib.js", "index.js", "schema.sql", "wrangler.toml"]) check("worker-consent/" + f + " exists", exists("worker-consent/" + f), true);
check("settings are all there", ["FIREBASE_PROJECT_ID", "SITE_URL", "MAIL_FROM", "ALLOWED_ORIGINS"].filter((k) => !toml.includes(k + " =")), []);
check("neither secret is written in the project", [/RESEND_API_KEY\s*=/.test(toml), /CONSENT_PEPPER\s*=/.test(toml), /re_[A-Za-z0-9]{10,}/.test(toml + read("js/consent-config.js"))], [false, false, false]);
check("the hourly cleanup is scheduled", /crons = \["0 \* \* \* \*"\]/.test(toml), true);
const tables = [...schema.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]);
check("every table used exists in schema.sql", [...index.matchAll(/(?:FROM|INTO|UPDATE) (?!SET)(\w+)/g)].map((m) => m[1]).filter((t) => !tables.includes(t)), []);
check("the schema stores no readable email or ip", /\b(email|ip)\s+TEXT/i.test(schema), false);
check("the website's Worker address is a secure address", /^https:\/\//.test(/CONSENT_WORKER_URL = "([^"]+)"/.exec(read("js/consent-config.js"))[1]), true);
check("hosting leaves the Worker and the email preview out", [JSON.parse(read("firebase.json")).hosting.ignore.includes("worker-consent/**"), JSON.parse(read("firebase.json")).hosting.ignore.includes("design/**")], [true, true]);

// ---------- house style
const written = ["js/consent-logic.js", "js/consent-client.js", "js/consent-config.js", "js/finish-signup.js", "js/who-are-you.js", "js/parental-consent.js", "js/parent-approval.js", "css/consent.css", "worker-consent/index.js", "worker-consent/lib.js", "worker-consent/schema.sql", "worker-consent/README.md", "worker-consent/wrangler.toml", "who-are-you.html", "parental-consent.html", "parent-approval.html"];
check("no long dashes", written.filter((f) => /[\u2013\u2014]/.test(read(f))), []);
check("no alert or confirm pop ups", written.filter((f) => /\b(alert|confirm)\(/.test(read(f))), []);

console.log(failed ? failed + " FAILED" : "ALL PASSED");
process.exit(failed ? 1 : 0);
