/* ==========================================================
   TRACKLY plain data
   Turns a Firestore document into a simple object we can keep anywhere
   (on screen, or in the short-term memory in cache.js).
   Dates become numbers (milliseconds), so they survive being saved as text.
   ========================================================== */

export function plain(snapshot) {
  const data = snapshot.data();
  const out = { id: snapshot.id };
  Object.keys(data).forEach((key) => {
    const value = data[key];
    if (value && typeof value.toMillis === "function") out[key] = value.toMillis(); // a Firestore date
    else if (value instanceof Date) out[key] = value.getTime();
    else out[key] = value;
  });
  return out;
}