import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";

let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(ok ? "PASS" : "FAIL", name, ok ? "" : "got " + JSON.stringify(got) + " want " + JSON.stringify(want));
};
const url = (p) => new URL("../" + p, import.meta.url);
const read = (p) => readFileSync(url(p), "utf8");
const exists = (p) => existsSync(url(p));
const size = (p) => (exists(p) ? statSync(url(p)).size : Infinity); // a missing file counts as too big, so its check fails instead of crashing
const pngSize = (p) => { if (!exists(p)) return null; const b = readFileSync(url(p)); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
const visible = (html) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, " ").replace(/&middot;/g, ".").replace(/&rsquo;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");

const html = read("index.html");
const text = visible(html);
const meta = (name) => (new RegExp('<meta (?:name|property)="' + name + '" content="([^"]*)"').exec(html) || [])[1];
const canonical = (/<link rel="canonical" href="([^"]+)"/.exec(html) || [])[1];

// ---------- every file this page needs must be in the project (the message names the missing ones)
const required = ["index.html", "404.html", "sitemap.xml", "robots.txt", "favicon.ico", "privacy.html", "terms.html", "contact.html", "login.html", "signup.html",
  "assets/images/logo.webp", "assets/images/og-image.png", "assets/images/favicon-96.png", "assets/images/apple-touch-icon.png"];
check("every file the home page needs is in the project", required.filter((f) => !exists(f)), []);

// ---------- what search engines read
check("exactly one h1", (html.match(/<h1[\s>]/g) || []).length, 1);
const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)[1].replace(/<[^>]+>/g, "");
check("the h1 holds the ranking words", [/student assignment tracker/i.test(h1), /due date reminders/i.test(h1)], [true, true]);
const title = /<title>([^<]+)<\/title>/.exec(html)[1];
check("title has the main words and fits in a search result", [/Student Assignment Tracker/.test(title), title.length <= 65], [true, true]);
check("description is a good length and says what Trackly is", [meta("description").length >= 110 && meta("description").length <= 165, /assignment tracker/i.test(meta("description"))], [true, true]);
check("the page can be found by Google", /name="robots" content="index, follow/.test(html), true);
check("canonical is the main address", canonical, "https://trackly.ng/");
check("link preview address matches", [meta("og:url"), meta("og:type"), meta("twitter:card")], ["https://trackly.ng/", "website", "summary_large_image"]);
check("link preview title and description are set", [meta("og:title"), meta("og:description")], [title, meta("description")]);
const ogFile = meta("og:image").replace("https://trackly.ng/", "");
check("share image exists, is 1200 by 630 and light", [exists(ogFile), pngSize(ogFile), size(ogFile) < 120000], [true, [1200, 630], true]);
check("share image has a description for screen readers", meta("og:image:alt").length > 20, true);

const ld = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)[1]);
const graph = ld["@graph"];
check("structured data describes the site, the organization and the web app", graph.map((g) => g["@type"]), ["WebSite", "Organization", "WebApplication"]);
check("structured data points at the main address", graph.every((g) => g.url === "https://trackly.ng/"), true);
check("the organization logo file exists: " + graph[1].logo.replace("https://trackly.ng/", ""), exists(graph[1].logo.replace("https://trackly.ng/", "")), true);

// ---------- speed
const scripts = html.match(/<script[\s>]/g) || [];
// the only script besides the structured data is the app install script (it registers the service worker and shows the install button)
check("no JavaScript, only the structured data block and the install script", [scripts.length, [...html.matchAll(/<script(?![^>]*ld\+json)[^>]*>/g)].map((m) => m[0])], [2, ['<script type="module" src="/js/pwa.js">']]);
check("no stylesheet files, fonts or imports to wait for", [/<link[^>]*rel="stylesheet"/.test(html), /@import|@font-face|fonts\.googleapis/.test(html)], [false, false]);
const outside = [...html.matchAll(/(?:src|href)="(https?:[^"]+)"/g)].map((m) => m[1]);
check("the only outside address is the canonical link", outside, ["https://trackly.ng/"]);
check("the only image is the small logo", [...html.matchAll(/<img [^>]*src="([^"]+)"/g)].map((m) => m[1]), ["assets/images/logo.webp"]);
check("every image has a description and a size", [...html.matchAll(/<img [^>]*>/g)].every((m) => /alt="[^"]+"/.test(m[0]) && /width="\d+"/.test(m[0]) && /height="\d+"/.test(m[0])), true);
check("the page is light", [size("index.html") < 30000, size("assets/images/logo.webp") < 30000], [true, true]);
check("everything the first screen loads is under 60 KB", size("index.html") + size("assets/images/logo.webp") < 60000, true);
check("the big old logo is not used", html.includes("trackly-logo.png"), false);

// ---------- links
const pageIds = {};
const idsOf = (file) => (pageIds[file] = pageIds[file] || new Set([...read(file).matchAll(/id="([^"]+)"/g)].map((m) => m[1])));
const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]).filter((h) => !/^(https?:|mailto:)/.test(h));
const broken = [];
for (const h of hrefs) {
  const [file, hash] = h.split("#");
  if (!file) { if (!idsOf("index.html").has(hash)) broken.push(h); continue; }
  if (!exists(file)) { broken.push(h); continue; }
  if (hash && !idsOf(file).has(hash)) broken.push(h);
}
check("every link goes somewhere real", broken, []);
for (const must of ["privacy.html", "terms.html", "privacy.html#google", "signup.html", "login.html#signin", "contact.html"]) {
  check("links to " + must, hrefs.includes(must), true);
}
check("no email address on the page (Contact points to the privacy policy)", /[\w.+-]+@[\w-]+\.[\w.-]+/.test(html), false);

// ---------- the top bar on a phone: only Sign in
const header = /<header class="top">[\s\S]*?<\/header>/.exec(html)[0];
check("the top bar has Sign in and Create account on wide screens", [header.includes('href="login.html#signin"'), header.includes('class="btn btn-primary signup-link" href="signup.html"')], [true, true]);
check("on phones the top bar hides Create account", /@media \(max-width:600px\)\{\.signup-link\{display:none\}\}/.test(html), true);
check("only the top bar link is hidden, Create account stays in the hero, final section and footer", [(html.match(/signup-link/g) || []).length === 2, (html.match(/href="signup\.html"/g) || []).length], [true, 4]);

// ---------- what Google looks at: a public description, and the privacy link
check("describes what Trackly does and does not do with Google Calendar", ["What Trackly does", "What Trackly does not do", "Read or change your other calendar events", "Sell your Google data"].every((s) => text.includes(s)), true);
check("Limited Use statement, word for word", text.includes("Trackly's use and transfer to any other app of information received from Google APIs will adhere to the Google API Services User Data Policy, including the Limited Use requirements."), true);
check("the page and the legal pages share the same facts: age rule", [/18 and over/.test(text), /parent or guardian/.test(text)], [true, true]);

// ---------- only claims that are true
const forbidden = [/\bfree\b/i, /\bsms\b/i, /whatsapp/i, /mobile app/i, /app store|play store/i, /\bai\b|artificial intelligence/i, /two-way|real-time|\bsync\b/i, /thousands|millions|10,000/i, /\bbest\b|#1|award/i, /verified by google|google partner|official/i, /\bdownload/i, /push notification/i];
check("no claims about things Trackly does not have", forbidden.filter((re) => re.test(text)).map(String), []);
const labels = read("js/assignments.js");
check("status names on the page are the ones in the app", ["Pending", "In Progress", "Submitted", "Overdue"].every((s) => labels.includes('"' + s + '"') && text.includes(s)), true);
check("the pages the features describe exist", ["calendar.html", "add-course.html", "add-assignment.html", "profile.html"].every(exists), true);
check("the reminder times on the page match the code", [/DAILY_HOUR = 8/.test(read("js/reminders.js")), /DUE_DAY_MINUTES = \[120, 60, 30, 0\]/.test(read("js/reminders.js")), text.includes("8:00"), text.includes("2 hours, 1 hour and 30 minutes before")], [true, true, true, true]);
check("reminders are not promised as a guarantee", /not a guarantee/.test(text), true);

// ---------- icons
check("icons exist and are the right size", [exists("favicon.ico"), pngSize("assets/images/favicon-96.png"), pngSize("assets/images/apple-touch-icon.png")], [true, [96, 96], [180, 180]]);
check("the icons are linked", ["favicon.ico", "assets/images/favicon-96.png", "assets/images/apple-touch-icon.png"].every((f) => html.includes('href="' + f + '"')), true);

// ---------- sitemap and robots
const sitemap = read("sitemap.xml");
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
check("sitemap lists the public pages", locs, ["https://trackly.ng/", "https://trackly.ng/privacy", "https://trackly.ng/terms", "https://trackly.ng/contact"]);
const privateFiles = readdirSync(url("")).filter((f) => f.endsWith(".html") && /name="robots" content="noindex/.test(read(f)));
check("the sitemap lists no private page", locs.filter((l) => privateFiles.some((f) => l.endsWith("/" + f.replace(".html", "")))), []);
check("the public pages are not marked private", ["index.html", "privacy.html", "terms.html", "contact.html"].every((f) => !privateFiles.includes(f)), true);
const robots = read("robots.txt");
check("robots allows crawling and points to the sitemap", [/^Allow: \/$/m.test(robots), /^Disallow: \/\s*$/m.test(robots), robots.includes("Sitemap: https://trackly.ng/sitemap.xml")], [true, false, true]);
for (const [page, loc] of [["privacy.html", "https://trackly.ng/privacy"], ["terms.html", "https://trackly.ng/terms"], ["contact.html", "https://trackly.ng/contact"]]) {
  const p = read(page);
  check(page + ": canonical matches the sitemap", p.includes('<link rel="canonical" href="' + loc + '">') && locs.includes(loc), true);
  check(page + ": logo and Back link go to the home page, with the small logo", [p.includes('class="legal-logo" href="index.html"'), p.includes('class="legal-back" href="index.html"'), p.includes("logo.webp"), p.includes("trackly-logo.png")], [true, true, true, false]);
}

// ---------- the 404 page (shown at any depth, so everything starts with /)
const nf = read("404.html");
check("404 is private, has only the install script, and no outside requests", [/name="robots" content="noindex"/.test(nf), [...nf.matchAll(/<script[^>]*>/g)].map((m) => m[0]).join("") === '<script type="module" src="/js/pwa.js">', /<link[^>]*rel="stylesheet"/.test(nf), /(?:src|href)="https?:/.test(nf)], [true, true, false, false]);
check("404 links start with a slash so they work at any depth", [...nf.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]).filter((v) => !v.startsWith("/")), []);
check("404 links to the home page and the images exist", [nf.includes('href="/"'), exists("assets/images/logo.webp"), nf.includes("Error 404")], [true, true, true]);
check("404 is small", size("404.html") < 8000, true);

// ---------- house style
for (const f of ["index.html", "404.html", "sitemap.xml", "robots.txt", "privacy.html", "terms.html", "contact.html"]) {
  check(f + ": no long dashes", /[\u2013\u2014]/.test(read(f)), false);
}

console.log(failed ? failed + " FAILED" : "ALL PASSED");
process.exit(failed ? 1 : 0);
