/* ==========================================================
   TRACKLY image deletion (logic and a small client, tested without a browser)
   Photos live in Cloudinary. The browser cannot delete them (that needs a secret), so it asks the image Worker,
   which checks the student's Firebase sign in and then deletes. This file works out WHICH photos to ask for,
   and talks to the Worker.
   ========================================================== */

export class ImageDeleteError extends Error {
  constructor(code, status = 0) {
    super(code);
    this.name = "ImageDeleteError";
    this.code = code;
    this.status = status;
  }
}

const ID_OK = /^[A-Za-z0-9_\-/.]{1,200}$/;

/* Our uploads come back as .../image/upload/v1699999999/folder/name.jpg, and the id is "folder/name".
   Returns "" for anything that is not one of our Cloudinary pictures (for example a Google profile photo). */
export function publicIdFromUrl(url) {
  const m = /^https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/(.+)$/.exec(String(url || ""));
  if (!m) return "";
  let rest = m[1].split(/[?#]/)[0];
  const version = /(?:^|\/)v\d+\/(.+)$/.exec(rest);
  if (version) rest = version[1];
  rest = rest.replace(/\.[A-Za-z0-9]+$/, "");
  try { rest = decodeURIComponent(rest); } catch (err) { return ""; }
  return ID_OK.test(rest) && !rest.includes("..") && !rest.startsWith("/") ? rest : "";
}

/* Every Cloudinary photo that belongs to a student: course photos and the profile photo. No duplicates, no empties. */
export function collectImageIds({ courses = [], customPhotoPublicId = "", customPhotoURL = "" }) {
  const ids = courses.map((c) => c && c.imagePublicId).filter(Boolean);
  const profile = customPhotoPublicId || publicIdFromUrl(customPhotoURL);
  if (profile) ids.push(profile);
  return Array.from(new Set(ids.filter((id) => ID_OK.test(id) && !id.includes(".."))));
}

const CHUNK = 50;

export function createImageDeleter({ workerUrl, getToken, fetchFn = (...args) => fetch(...args), timeoutMs = 20000 }) {
  const base = String(workerUrl || "").replace(/\/+$/, "");

  async function post(ids) {
    let token;
    try { token = await getToken(); } catch (err) { throw new ImageDeleteError("sign_in_needed", 401); }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await fetchFn(base + "/images/delete", {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ publicIds: ids }),
        signal: controller.signal
      });
    } catch (err) {
      throw new ImageDeleteError(err && err.name === "AbortError" ? "timeout" : "network");
    } finally {
      clearTimeout(timer);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ImageDeleteError(data.error || "photos", res.status);
    return data;
  }

  return {
    /* Deletes the photos, 50 at a time. Photos that are already gone count as deleted. Returns how many were removed. */
    async deleteImages(ids) {
      const list = Array.from(new Set((ids || []).filter(Boolean)));
      if (!list.length) return 0;
      if (!base) throw new ImageDeleteError("not_configured");
      let removed = 0;
      for (let i = 0; i < list.length; i += CHUNK) {
        const data = await post(list.slice(i, i + CHUNK));
        removed += (data.deleted || 0) + (data.notFound || 0);
      }
      return removed;
    }
  };
}