/* ==========================================================
   TRACKLY course photos
   Makes course header photos load faster by sending them through Cloudinary,
   which shrinks and compresses them before they reach the student.

   To switch it on, paste your Cloudinary cloud name below
   (Cloudinary dashboard, top left). Leave it empty and photos load directly.
   Cloudinary may also need to allow Pexels as a source:
   Settings, Security, "Allowed fetch domains" (add images.pexels.com).
   ========================================================== */

export const CLOUDINARY_CLOUD_NAME = "";

export function headerImage(url, width = 640) {
  if (typeof url !== "string" || !url.startsWith("https://")) return "";
  const fromPexels = url.startsWith("https://images.pexels.com/");
  if (!CLOUDINARY_CLOUD_NAME || !fromPexels) return url;

  const height = Math.round(width * 0.375);
  return "https://res.cloudinary.com/" + CLOUDINARY_CLOUD_NAME +
    "/image/fetch/f_auto,q_auto,c_fill,w_" + width + ",h_" + height + "/" + encodeURIComponent(url);
}