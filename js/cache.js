/* ==========================================================
   TRACKLY short-term memory
   Remembers answers from Firestore for a minute or two, on the student's own device,
   so moving between pages does not ask the database the same questions again.
   Every question you skip is a read you do not pay for.

   - It lives in the browser's session storage, so it disappears when the tab closes.
   - Every item belongs to one student (their uid) and has a short life (ttl).
   - Whenever the student changes something (adds or edits a course or assignment),
     call invalidateCache(uid), so they never see old numbers.
   - On sign out, clearAllCache() removes everything.
   ========================================================== */

const PREFIX = "trackly:v1:";
const memory = new Map(); // used if session storage is blocked

function keyFor(uid, key) {
  return PREFIX + uid + ":" + key;
}

function store() {
  try {
    return window.sessionStorage;
  } catch (err) {
    return null;
  }
}

export function readCache(uid, key, ttlMs) {
  const k = keyFor(uid, key);
  let raw = null;
  try {
    const s = store();
    raw = s ? s.getItem(k) : memory.get(k) || null;
  } catch (err) { /* ignore */ }
  if (!raw) return null;

  try {
    const entry = JSON.parse(raw);
    if (Date.now() - entry.t > ttlMs) return null;
    return entry.d;
  } catch (err) {
    return null;
  }
}

export function writeCache(uid, key, data) {
  const k = keyFor(uid, key);
  const raw = JSON.stringify({ t: Date.now(), d: data });
  try {
    const s = store();
    if (s) s.setItem(k, raw);
    else memory.set(k, raw);
  } catch (err) { /* storage full or blocked: skipping the memory is harmless */ }
}

/* Forget everything about one student */
export function invalidateCache(uid) {
  removeWhere((k) => k.startsWith(PREFIX + uid + ":"));
}

/* Forget everything (used on sign out) */
export function clearAllCache() {
  removeWhere((k) => k.startsWith(PREFIX));
}

function removeWhere(test) {
  try {
    const s = store();
    if (s) {
      const keys = [];
      for (let i = 0; i < s.length; i += 1) keys.push(s.key(i));
      keys.filter(test).forEach((k) => s.removeItem(k));
    }
  } catch (err) { /* ignore */ }
  Array.from(memory.keys()).filter(test).forEach((k) => memory.delete(k));
}

/* Use the remembered answer if it is fresh, otherwise ask (loader) and remember the answer */
export async function cached(uid, key, ttlMs, loader) {
  const hit = readCache(uid, key, ttlMs);
  if (hit !== null) return hit;
  const data = await loader();
  writeCache(uid, key, data);
  return data;
}