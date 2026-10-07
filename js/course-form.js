/* ==========================================================
   TRACKLY course form rules
   Turns what the student typed on the Edit Course page into the fields
   we save. Kept in its own file so it can be tested without a browser.
   ========================================================== */

/* What a course looks like with no photo at all */
export const CLEARED_PHOTO = { imageUrl: "", imagePublicId: "", imageSource: "", imageCredit: null };

/* values: { title, code, shortName, instructor, color }
   photo:  { kind: "keep" }                       leave the photo as it is
           { kind: "replace", fields: {...} }     save a new photo
           { kind: "clear" }                      remove the photo

   Cleared text boxes are saved as empty text, so the old value is really gone. */
export function buildCourseUpdate(values, photo) {
  const data = {
    title: String(values.title || "").trim(),
    code: String(values.code || "").trim(),
    shortName: String(values.shortName || "").trim(),
    instructor: String(values.instructor || "").trim(),
    color: values.color
  };

  if (photo.kind === "replace") {
    // imageCredit is cleared first, so a student's own photo never keeps an old Pixabay credit
    Object.assign(data, { imageCredit: null }, photo.fields);
  } else if (photo.kind === "clear") {
    Object.assign(data, CLEARED_PHOTO);
  }
  return data;
}

/* On the Add Course page: has the student typed or chosen anything yet?
   An untouched form has nothing to lose, so leaving it never shows the pop-up box. */
export function isNewCourseDirty(values, photoKind, defaultColor = "#00D996") {
  const typed = Boolean(values.title || values.code || values.shortName || values.instructor);
  const colorChanged = String(values.color || "").toLowerCase() !== defaultColor.toLowerCase();
  return typed || colorChanged || photoKind === "upload" || photoKind === "suggested";
}