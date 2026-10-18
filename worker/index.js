/* ==========================================================
   TRACKLY image worker (Cloudflare Worker)
   Finds a photo for a course title using the Pixabay API.
   The Pixabay key lives here, as a secret, so it never reaches the browser.

   Ask it:   GET /images?q=Introduction%20to%20Biology
   It answers with up to 6 photos:
     { "query": "biology laboratory microscope",
       "results": [ { "id", "preview", "full", "user", "pageUrl" } ] }

   It also DELETES photos, when a student removes a photo or deletes their account:
     POST /images/delete   with  { "publicIds": ["folder/name", ...] }  (at most 50)
   The browser cannot delete from Cloudinary (that needs a secret), so it asks here. Every call must carry the
   student's Firebase sign in token, which this Worker checks. This part is self contained in this one file,
   so it works whether you deploy with Wrangler or paste the file into the Cloudflare website.

   Settings (Cloudflare dashboard, your Worker, Settings):
     PIXABAY_KEY             (Secret, required)  your Pixabay API key
     ALLOWED_ORIGINS         (Variable, optional) websites allowed to ask, separated by commas
     CACHE                   (KV binding, optional but recommended) remembers answers for 24 hours
   For deleting photos:
     FIREBASE_PROJECT_ID     (Variable)  trackly-e18d8
     CLOUDINARY_CLOUD_NAME   (Variable)  your Cloudinary cloud name
     CLOUDINARY_API_KEY      (Secret)    from the Cloudinary dashboard
     CLOUDINARY_API_SECRET   (Secret)    from the Cloudinary dashboard
     IMAGE_FOLDER_PREFIX     (Variable, optional) only delete pictures whose id starts with this, for example "trackly/"
   ========================================================== */

const DEFAULT_ORIGINS = [
  "https://trackly.ng",
  "https://www.trackly.ng",
  "http://127.0.0.1:5000",
  "http://localhost:5000",
  "http://127.0.0.1:5500",
  "http://localhost:5500"
];

const CACHE_SECONDS = 86400; // Pixabay asks us to remember results for 24 hours
const MAX_RESULTS = 6;
const FALLBACK_QUERY = "students studying books";

/* Words that say nothing about the subject, so we drop them */
const FILLER = new Set([
  "introduction", "intro", "to", "of", "and", "the", "for", "in", "on", "with", "a", "an",
  "principles", "fundamentals", "foundations", "basics", "basic", "advanced", "intermediate",
  "general", "applied", "elementary", "topics", "course", "level", "part", "theory", "practice",
  "practical", "survey", "special", "i", "ii", "iii", "iv", "v", "vi"
]);

/* Subjects we recognise, so the photo search uses better words than the raw title.
   "match" are the starts of words to look for. The first subject that matches wins. */
const SUBJECTS = [
  { match: ["statist", "probab"], query: "statistics data charts" },
  { match: ["comput", "program", "software", "algorithm", "data struct", "coding", "database", "cyber", "informatics", "information tech", "web dev", "network"], query: "computer programming code laptop" },
  { match: ["biochem", "microbio", "biolog", "zoolog", "botan", "genetic", "ecolog"], query: "biology laboratory microscope" },
  { match: ["chem"], query: "chemistry laboratory glassware" },
  { match: ["physic", "quantum", "thermodyn", "astronom"], query: "physics science laboratory" },
  { match: ["electr", "electron"], query: "electronics circuit board" },
  { match: ["engineer", "mechanic", "civil", "structural"], query: "engineering blueprint tools" },
  { match: ["mathem", "math", "calcul", "algebra", "geometr", "trigonom"], query: "mathematics equations chalkboard" },
  { match: ["econom"], query: "economics finance charts" },
  { match: ["account", "financ", "banking", "audit", "taxation"], query: "accounting calculator finance" },
  { match: ["business", "manage", "market", "entrepren", "administrat", "commerce"], query: "business meeting office" },
  { match: ["law", "legal", "jurisprud", "constitution"], query: "law books courtroom" },
  { match: ["nurs", "medic", "anatom", "physiolog", "pharmac", "patholog", "health", "surgery", "dental"], query: "medical stethoscope hospital" },
  { match: ["psycholog", "behavio", "cognit"], query: "psychology mind brain" },
  { match: ["sociolog", "anthropolog", "social"], query: "people community society" },
  { match: ["politic", "government", "public admin", "international relations", "diplomacy"], query: "government politics parliament" },
  { match: ["histor", "archaeolog", "civilization"], query: "history old books library" },
  { match: ["geograph", "geolog", "earth", "environment", "climate", "ecosystem"], query: "geography map landscape" },
  { match: ["agric", "crop", "soil", "animal science", "farming", "forestry", "fisher"], query: "agriculture farm field" },
  { match: ["architect", "urban", "building", "design", "drawing"], query: "architecture design drawing" },
  { match: ["journal", "mass comm", "media", "broadcast", "public relations"], query: "journalism media camera" },
  { match: ["english", "literature", "linguist", "communication", "writing", "poetry"], query: "english literature books" },
  { match: ["french", "spanish", "german", "arabic", "yoruba", "igbo", "hausa", "language"], query: "language learning books" },
  { match: ["educat", "teaching", "pedagog", "curriculum"], query: "classroom teaching school" },
  { match: ["philosoph", "ethic", "logic"], query: "philosophy books thinking" },
  { match: ["religio", "theolog", "christian", "islamic", "bible", "quran"], query: "religion study books" },
  { match: ["music", "choir", "instrument"], query: "music instruments" },
  { match: ["art", "painting", "sculpt", "creative"], query: "art painting studio" },
  { match: ["sport", "physical education", "kinesio", "fitness"], query: "sports training field" }
];

/* Turns a course title into a good photo search phrase */
export function buildQuery(title) {
  const text = String(title || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Longer stems (6+ letters) can sit anywhere in a word, so "microeconomics" finds "econom".
  // Short stems must start a word, so "art" does not match "part" and "logic" does not match "technological".
  for (const subject of SUBJECTS) {
    const found = subject.match.some((stem) =>
      new RegExp((stem.length >= 6 ? "" : "\\b") + stem).test(text)
    );
    if (found) return subject.query;
  }

  const words = text
    .split(" ")
    .filter((w) => w.length > 1 && !FILLER.has(w) && !/^\d+$/.test(w))
    .slice(0, 4);
  return words.length ? words.join(" ") : FALLBACK_QUERY;
}

/* ---------- Talking to Pixabay ---------- */
class UpstreamError extends Error {
  constructor(status) {
    super("Pixabay answered " + status);
    this.status = status;
  }
}

async function searchPixabay(query, key) {
  const api = new URL("https://pixabay.com/api/");
  api.searchParams.set("key", key);
  api.searchParams.set("q", query.slice(0, 100));
  api.searchParams.set("image_type", "photo");
  api.searchParams.set("orientation", "horizontal");
  api.searchParams.set("safesearch", "true");
  api.searchParams.set("min_width", "800");
  api.searchParams.set("order", "popular");
  api.searchParams.set("lang", "en");
  api.searchParams.set("per_page", "12");

  const res = await fetch(api.toString());
  if (!res.ok) throw new UpstreamError(res.status);
  const data = await res.json();

  return (data.hits || [])
    .filter((hit) => hit.webformatURL && hit.largeImageURL)
    .slice(0, MAX_RESULTS)
    .map((hit) => ({
      id: hit.id,
      preview: hit.webformatURL,   // about 640px wide, quick to show
      full: hit.largeImageURL,     // up to 1280px wide, what we keep
      user: hit.user,
      pageUrl: hit.pageURL
    }));
}

/* ---------- Answers ---------- */
function reply(body, status, cors, maxAge) {
  const headers = { "Content-Type": "application/json; charset=utf-8", ...cors };
  if (maxAge) headers["Cache-Control"] = "public, max-age=" + maxAge;
  return new Response(JSON.stringify(body), { status, headers });
}

async function handleImages(url, env, cors) {
  const title = (url.searchParams.get("q") || "").trim();
  if (title.length < 2 || title.length > 80) {
    return reply({ error: "Send a course title between 2 and 80 characters." }, 400, cors);
  }
  if (!env.PIXABAY_KEY) {
    return reply({ error: "The photo service is not set up yet." }, 500, cors);
  }

  const query = buildQuery(title);
  const cacheKey = "pixabay:" + query;

  try {
    if (env.CACHE) {
      const hit = await env.CACHE.get(cacheKey, "json");
      if (hit) return reply({ query, results: hit, cached: true }, 200, cors, 3600);
    }

    let results = await searchPixabay(query, env.PIXABAY_KEY);
    let usedQuery = query;
    if (results.length === 0 && query !== FALLBACK_QUERY) {
      usedQuery = FALLBACK_QUERY;
      results = await searchPixabay(FALLBACK_QUERY, env.PIXABAY_KEY);
    }

    if (env.CACHE && results.length) {
      await env.CACHE.put(cacheKey, JSON.stringify(results), { expirationTtl: CACHE_SECONDS });
    }
    return reply({ query: usedQuery, results }, 200, cors, 3600);
  } catch (err) {
    console.error("Image search failed:", err && err.message);
    if (err instanceof UpstreamError && err.status === 429) {
      return reply({ error: "The photo service is busy. Try again in a minute." }, 429, cors);
    }
    return reply({ error: "We could not find photos right now." }, 502, cors);
  }
}

/* ---------- Deleting photos ---------- */

/* Checking a Firebase sign in token (the student's proof of who they are).
   Same rules as the calendar Worker: signature from Google's public keys, audience = our project, issuer, expiry. */
const JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
let jwks = { keys: [], at: 0 };

function b64decode(text) {
  const clean = String(text).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(clean + "=".repeat((4 - (clean.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function loadKeys(now) {
  if (jwks.keys.length && now - jwks.at < 3600 * 1000) return jwks.keys;
  const res = await fetch(JWKS_URL);
  if (!res.ok) throw new Error("Could not load Firebase keys");
  jwks = { keys: (await res.json()).keys || [], at: now };
  return jwks.keys;
}

async function verifyFirebaseToken(token, projectId, now = Date.now()) {
  try {
    const parts = String(token || "").split(".");
    if (parts.length !== 3) return null;
    const decode = new TextDecoder();
    const header = JSON.parse(decode.decode(b64decode(parts[0])));
    if (header.alg !== "RS256" || typeof header.kid !== "string") return null;
    let jwk = (await loadKeys(now)).find((k) => k.kid === header.kid);
    if (!jwk) { jwks = { keys: [], at: 0 }; jwk = (await loadKeys(now)).find((k) => k.kid === header.kid); }
    if (!jwk) return null;
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64decode(parts[2]), new TextEncoder().encode(parts[0] + "." + parts[1]));
    if (!valid) return null;
    const p = JSON.parse(decode.decode(b64decode(parts[1])));
    const sec = Math.floor(now / 1000);
    if (p.aud !== projectId || p.iss !== "https://securetoken.google.com/" + projectId) return null;
    if (typeof p.exp !== "number" || p.exp <= sec || typeof p.iat !== "number" || p.iat > sec + 300) return null;
    return typeof p.sub === "string" && p.sub ? { uid: p.sub } : null;
  } catch (err) {
    return null;
  }
}

const PUBLIC_ID_OK = /^[A-Za-z0-9_\-/.]{1,200}$/;
const MAX_DELETE = 50;

async function handleDelete(request, env, cors) {
  if (!env.FIREBASE_PROJECT_ID || !env.CLOUDINARY_CLOUD_NAME || !env.CLOUDINARY_API_KEY || !env.CLOUDINARY_API_SECRET) {
    return reply({ error: "not_configured" }, 500, cors);
  }
  const header = request.headers.get("Authorization") || "";
  const user = await verifyFirebaseToken(header.startsWith("Bearer ") ? header.slice(7) : "", env.FIREBASE_PROJECT_ID);
  if (!user) return reply({ error: "sign_in_needed" }, 401, cors);

  const text = await request.text();
  if (text.length > 8192) return reply({ error: "too_big" }, 413, cors);
  let body;
  try { body = JSON.parse(text); } catch (err) { return reply({ error: "bad_request" }, 400, cors); }

  // Picture ids are long and random, and nobody can see another student's, so only the owner can name them.
  // IMAGE_FOLDER_PREFIX (optional) also keeps this from touching anything outside Trackly's own folder.
  const prefix = env.IMAGE_FOLDER_PREFIX || "";
  const ids = body && body.publicIds;
  const bad = !Array.isArray(ids) || ids.length < 1 || ids.length > MAX_DELETE || ids.some((id) =>
    typeof id !== "string" || !PUBLIC_ID_OK.test(id) || id.includes("..") || id.startsWith("/") || (prefix && !id.startsWith(prefix)));
  if (bad) return reply({ error: "bad_request" }, 400, cors);

  const params = new URLSearchParams();
  ids.forEach((id) => params.append("public_ids[]", id));
  let res;
  try {
    res = await fetch("https://api.cloudinary.com/v1_1/" + encodeURIComponent(env.CLOUDINARY_CLOUD_NAME) + "/resources/image/upload", {
      method: "DELETE",
      headers: { Authorization: "Basic " + btoa(env.CLOUDINARY_API_KEY + ":" + env.CLOUDINARY_API_SECRET), "Content-Type": "application/x-www-form-urlencoded" },
      body: params
    });
  } catch (err) {
    console.error("Cloudinary delete could not be reached");
    return reply({ error: "cloudinary" }, 502, cors);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error("Cloudinary delete failed with status", res.status); // never log the key or the secret
    return reply({ error: "cloudinary" }, 502, cors);
  }
  const outcome = Object.values(data.deleted || {});
  return reply({ deleted: outcome.filter((v) => v === "deleted").length, notFound: outcome.filter((v) => v === "not_found").length, requested: ids.length }, 200, cors);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const allowed = env.ALLOWED_ORIGINS
      ? env.ALLOWED_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean)
      : DEFAULT_ORIGINS;

    // Another website's page trying to use our Pixabay allowance? Say no.
    if (origin && !allowed.includes(origin)) {
      return new Response("Not allowed", { status: 403 });
    }

    const cors = origin
      ? { "Access-Control-Allow-Origin": origin, "Vary": "Origin" }
      : {};

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          ...cors,
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
          "Access-Control-Max-Age": "86400"
        }
      });
    }

    if (request.method === "GET" && url.pathname === "/images") {
      return handleImages(url, env, cors);
    }

    if (request.method === "POST" && url.pathname === "/images/delete") {
      return handleDelete(request, env, cors);
    }

    return reply({ ok: true, service: "trackly-images" }, 200, cors);
  }
};