/* ==========================================================
   TRACKLY course photos
   - uploads photos to Cloudinary (the student's own, or an automatic one)
   - asks our Cloudflare Worker for a suggested photo that fits a course title
   - makes stored photos load fast, using Cloudinary to shrink them

   FILL THESE IN (see the setup steps in the chat and in worker/README.md):
   ========================================================== */

/* Cloudinary dashboard, top left, "Cloud name" */
export const CLOUDINARY_CLOUD_NAME = "ra9ghfl3";

/* Cloudinary, Settings, Upload, Upload presets: an UNSIGNED preset you create */
export const CLOUDINARY_UPLOAD_PRESET = "trackly";

/* The address of your Worker, for example "https://trackly-images.your-name.workers.dev" */
export const IMAGE_WORKER_URL = "https://trackly-images.trackly409.workers.dev";

export function uploadsEnabled() {
  return Boolean(CLOUDINARY_CLOUD_NAME && CLOUDINARY_UPLOAD_PRESET);
}

/* Automatic photos need both the Worker (to find them) and Cloudinary (to keep a copy) */
export function suggestionsEnabled() {
  return Boolean(IMAGE_WORKER_URL) && uploadsEnabled();
}

/* ---------- Showing a stored photo ---------- */

/* Cloudinary resizes and compresses the photo on the way to the student:
   the right size for a card header, the lightest format the phone supports. */
export function headerImage(url, width = 640, height = Math.round(width * 0.375)) {
  if (typeof url !== "string" || !url.startsWith("https://")) return "";
  const marker = "/image/upload/";
  const at = url.indexOf(marker);
  if (!url.startsWith("https://res.cloudinary.com/") || at === -1) return url;

  const head = url.slice(0, at + marker.length);
  const tail = url.slice(at + marker.length);
  if (!/^v\d+\//.test(tail)) return url; // already has settings in it, leave it alone

  return head + "f_auto,q_auto,c_fill,g_auto,w_" + width + ",h_" + height + "/" + tail;
}

/* ---------- Shrinking a photo before it is uploaded ---------- */

async function loadPicture(file) {
  if ("createImageBitmap" in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch (err) { /* fall through to the older way */ }
  }
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = objectUrl;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/* Phone photos can be 5MB or more. This turns them into a small JPEG,
   which saves the student's data and uploads much faster on a weak network. */
export async function compressImage(file, maxSide = 1280, quality = 0.82) {
  const picture = await loadPicture(file);
  const width = picture.naturalWidth || picture.width;
  const height = picture.naturalHeight || picture.height;
  const scale = Math.min(1, maxSide / Math.max(width, height));

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#FFFFFF"; // so transparent PNGs do not turn black
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(picture, 0, 0, canvas.width, canvas.height);
  if (typeof picture.close === "function") picture.close();

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not shrink the photo"))),
      "image/jpeg",
      quality
    );
  });
}

/* ---------- Cloudinary ---------- */

/* source is either a photo file (Blob) or the web address of a photo.
   Returns { url, publicId } of our own copy. */
export async function uploadToCloudinary(source, timeoutMs = 45000) {
  if (!uploadsEnabled()) throw new Error("Cloudinary is not set up yet");

  const form = new FormData();
  form.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
  if (typeof source === "string") form.append("file", source);
  else form.append("file", source, "course.jpg");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch("https://api.cloudinary.com/v1_1/" + CLOUDINARY_CLOUD_NAME + "/image/upload", {
      method: "POST",
      body: form,
      signal: controller.signal
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.secure_url) {
      throw new Error((data.error && data.error.message) || "Upload failed (" + res.status + ")");
    }
    return { url: data.secure_url, publicId: data.public_id };
  } finally {
    clearTimeout(timer);
  }
}

/* ---------- Suggested photos from our Worker ---------- */

const PIXABAY_URL = /^https:\/\/([a-z0-9-]+\.)?pixabay\.com\//;

/* Returns up to 6 photos: { id, preview, full, user, pageUrl } */
export async function fetchSuggestions(title, timeoutMs = 12000) {
  if (!IMAGE_WORKER_URL) return [];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(IMAGE_WORKER_URL.replace(/\/$/, "") + "/images?q=" + encodeURIComponent(title), {
      signal: controller.signal
    });
    if (!res.ok) throw new Error("Photo search failed (" + res.status + ")");
    const data = await res.json();
    const list = Array.isArray(data.results) ? data.results : [];
    // Only accept photos that really come from Pixabay
    return list.filter((p) => PIXABAY_URL.test(p.preview) && PIXABAY_URL.test(p.full));
  } finally {
    clearTimeout(timer);
  }
}