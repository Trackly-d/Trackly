/* ==========================================================
   TRACKLY Edit Course page
   Opens from the Edit link on the course page: edit-course.html?id=THE_COURSE_ID
   Saves changes to users/{uid}/courses/{id}, then returns to the course page.

   The photo:
     - the current photo stays unless the student replaces it or removes it
     - a new photo is previewed at once and only uploaded when they click Save Changes
     - if they remove the photo, we suggest a new one from the course name

   Preview the design with sample data (nothing is saved):
     edit-course.html?demo=1          the form with a sample course
     edit-course.html?demo=notfound   the "course not found" screen
   ========================================================== */

import { startApp, setLeaveGuard, refreshLeaveGuard } from "./shell.js";
import { db, doc, setDoc, serverTimestamp } from "./firebase-config.js";
import { fetchCourse, fetchAssignments } from "./courses-data.js";
import { compressImage, uploadToCloudinary, fetchSuggestions, uploadsEnabled, suggestionsEnabled, headerImage } from "./images.js";
import { courseChipLabel } from "./course-labels.js";
import { buildCourseUpdate } from "./course-form.js";
import { showMessage, hideMessage, safeColor, plural } from "./ui.js";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const SUGGEST_DELAY_MS = 700;

const params = new URLSearchParams(window.location.search);
const DEMO = params.get("demo");
const COURSE_ID = params.get("id");

const $ = (id) => document.getElementById(id);
const views = {
  loading: $("edit-loading"),
  page: $("edit-page"),
  notfound: $("edit-notfound"),
  error: $("edit-error")
};

const form = $("course-form");
const titleInput = $("course-title");
const codeInput = $("course-code");
const shortInput = $("course-short");
const instructorInput = $("course-instructor");
const colorName = $("color-name");
const formError = $("form-error");
const saveStatus = $("save-status");
const saveBtn = $("save-btn");
const saveLabel = $("save-label");
const backLink = $("back-link");
const cancelLink = $("cancel-link");

const dropBtn = $("image-drop");
const fileInput = $("image-input");
const preview = $("image-preview");
const emptyBox = $("image-empty");
const loadingBox = $("image-loading");
const infoText = $("image-info");
const uploadOwn = $("upload-own");
const tryAnother = $("try-another");
const removeBtn = $("remove-photo");
const imageError = $("image-error");

/* A problem with the student's own photo, with a message we can show */
class PhotoError extends Error {}

let course = null;
let courseRef = null;
let courseUrl = "course.html";
let originalColor = "#00D996";
let initial = null;     // what the form held when it opened, to know if anything changed
let allowLeave = false; // true once we are leaving on purpose

const state = {
  kind: "none",          // "current" (the photo it already has), "upload" (a new one), "suggested" or "none"
  hadPhoto: false,       // the course had a photo when the page opened
  currentUrl: "",
  currentRemoved: false, // the student removed that photo
  file: null,
  objectUrl: "",
  results: [],
  index: 0,
  loading: false,
  dismissed: false,
  lastQuery: "",
  token: 0,
  uploaded: null
};

/* ---------- Which of the four things to show ---------- */
function showView(name) {
  Object.keys(views).forEach((key) => { views[key].hidden = key !== name; });
}

/* ---------- Form values ---------- */
function selectedColor() {
  const checked = form.querySelector('input[name="color"]:checked');
  return checked ? checked.value : originalColor;
}

function formValues() {
  return {
    title: titleInput.value.trim(),
    code: codeInput.value.trim(),
    shortName: shortInput.value.trim(),
    instructor: instructorInput.value.trim(),
    color: selectedColor()
  };
}

function isDirty() {
  const v = formValues();
  const photoChanged = state.kind !== (state.hadPhoto ? "current" : "none");
  return photoChanged ||
    v.title !== initial.title || v.code !== initial.code || v.shortName !== initial.shortName ||
    v.instructor !== initial.instructor || v.color !== initial.color;
}

function fillForm() {
  titleInput.value = course.title || "";
  codeInput.value = course.code || "";
  shortInput.value = course.shortName || "";
  instructorInput.value = course.instructor || "";

  originalColor = safeColor(course.color);
  const radios = Array.from(form.querySelectorAll('input[name="color"]'));
  radios.forEach((radio) => { radio.checked = false; });
  const match = radios.find((radio) => radio.value.toLowerCase() === originalColor.toLowerCase());
  if (match) {
    match.checked = true;
    colorName.textContent = match.dataset.name;
  } else {
    colorName.textContent = "Custom"; // a color from before, not in the list: it stays unless they pick another
  }

  initial = formValues();
}

/* The example card shows the course as it is now (it does not change while typing) */
function fillPreview(assignmentCount) {
  const card = $("preview-card");
  card.style.setProperty("--preview-color", originalColor);
  $("preview-chip").textContent = courseChipLabel(course);
  $("preview-title").textContent = course.title || "Untitled course";
  $("preview-instructor").textContent = course.instructor || "";
  $("preview-instructor-row").hidden = !course.instructor;
  $("preview-count").textContent = assignmentCount === null ? "" : plural(assignmentCount, "Assignment");
}

/* ---------- The photo box ---------- */
function render() {
  const suggestion = state.results[state.index] || null;
  let src = "";
  let info = "";

  if (state.kind === "upload") {
    src = state.objectUrl;
    info = "Your new photo. It replaces the current one when you click Save Changes.";
  } else if (state.kind === "current") {
    src = headerImage(state.currentUrl, 800, 500);
    info = "This is the current photo for this course.";
  } else if (state.kind === "suggested" && suggestion) {
    src = suggestion.preview;
    info = "Suggested photo for your course, by " + suggestion.user + " on Pixabay.";
  } else if (!state.loading) {
    if (state.hadPhoto) {
      info = "No photo. The current photo is removed when you click Save Changes.";
    } else {
      info = suggestionsEnabled()
        ? "Upload your own photo. If you do not, we will find one for your course."
        : "Upload a photo for your course header. This is optional.";
    }
  }

  preview.hidden = !src;
  if (src && preview.getAttribute("src") !== src) preview.src = src;
  emptyBox.hidden = Boolean(src) || state.loading;
  loadingBox.hidden = !state.loading || Boolean(src);
  infoText.textContent = info;
  refreshLeaveGuard(); // the photo may have changed
  uploadOwn.textContent = src ? "Replace photo" : "Upload your own";
  tryAnother.hidden = !(state.kind === "suggested" && state.results.length > 1);
  removeBtn.hidden = !src;
  dropBtn.setAttribute("aria-label", src ? "Replace the course photo" : "Add a course photo");
}

/* ---------- Suggested photos (only when the course has no photo) ---------- */
let suggestTimer = null;

function suggestionsAllowed() {
  return suggestionsEnabled() && (state.kind === "none" || state.kind === "suggested") && !state.dismissed;
}

function scheduleSuggestion(delay = SUGGEST_DELAY_MS) {
  clearTimeout(suggestTimer);
  if (!suggestionsAllowed()) return;
  suggestTimer = setTimeout(runSuggestion, delay);
}

async function runSuggestion() {
  const title = titleInput.value.trim();

  if (title.length < 3) {
    state.results = [];
    state.index = 0;
    state.lastQuery = "";
    state.loading = false;
    if (state.kind === "suggested") state.kind = "none";
    render();
    return;
  }
  if (title.toLowerCase() === state.lastQuery) return;

  state.lastQuery = title.toLowerCase();
  const token = ++state.token;
  state.loading = true;
  render();

  try {
    const results = await fetchSuggestions(title);
    if (token !== state.token) return;
    state.results = results;
    state.index = 0;
    if (suggestionsAllowed()) state.kind = results.length ? "suggested" : "none";
  } catch (err) {
    if (token !== state.token) return;
    console.warn("Could not get a suggested photo:", err);
    state.results = [];
    state.lastQuery = "";
    if (state.kind === "suggested") state.kind = "none";
  }
  state.loading = false;
  render();
}

/* ---------- The student's own photo ---------- */
function acceptFile(file) {
  hideMessage(imageError);
  if (!file) return;

  if (!uploadsEnabled()) {
    showMessage(imageError, "Photo uploads are not switched on yet.");
    return;
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    showMessage(imageError, "Use a JPG, PNG or WebP photo.");
    return;
  }
  if (file.size > MAX_FILE_BYTES) {
    showMessage(imageError, "That photo is too large. Choose one under 10 MB.");
    return;
  }

  if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
  state.file = file;
  state.objectUrl = URL.createObjectURL(file); // a preview made on their own phone, no upload yet
  state.kind = "upload";
  state.uploaded = null;
  state.loading = false;
  state.token += 1;
  render();
}

function removePhoto() {
  hideMessage(imageError);

  if (state.kind === "upload") {
    // Take back the new photo: the current one returns, unless they already removed it
    URL.revokeObjectURL(state.objectUrl);
    state.objectUrl = "";
    state.file = null;
    state.uploaded = null;
    fileInput.value = "";
    if (state.hadPhoto && !state.currentRemoved) state.kind = "current";
    else state.kind = state.results.length && !state.dismissed ? "suggested" : "none";
  } else if (state.kind === "current") {
    state.currentRemoved = true;
    state.kind = "none";
    state.dismissed = false;
    state.lastQuery = "";
    render();
    scheduleSuggestion(0); // look for a new photo from the course name
    return;
  } else if (state.kind === "suggested") {
    state.dismissed = true;
    state.kind = "none";
  }
  render();
}

/* ---------- Saving ---------- */
function withTimeout(promise, ms, code) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(code)), ms))
  ]);
}

function setSaving(on) {
  saveBtn.disabled = on;
  saveLabel.textContent = on ? "Saving..." : "Save Changes";
  [dropBtn, uploadOwn, tryAnother, removeBtn].forEach((button) => { button.disabled = on; });
  if (!on) hideMessage(saveStatus);
}

/* Decides what happens to the photo, and uploads the new one if there is one */
async function preparePhoto() {
  if (state.kind === "current") return { kind: "keep" };

  if (state.kind === "none") {
    return state.hadPhoto ? { kind: "clear" } : { kind: "keep" };
  }

  if (state.kind === "upload" && state.file) {
    if (state.uploaded && state.uploaded.key === state.file) return state.uploaded.photo;
    showMessage(saveStatus, "Uploading your photo...");

    let blob;
    try {
      blob = await compressImage(state.file);
    } catch (err) {
      console.error("Could not shrink the photo:", err);
      throw new PhotoError("We could not read that photo. Try a different one, or remove it.");
    }
    try {
      const up = await uploadToCloudinary(blob);
      const photo = { kind: "replace", fields: { imageUrl: up.url, imagePublicId: up.publicId, imageSource: "upload" } };
      state.uploaded = { key: state.file, photo };
      return photo;
    } catch (err) {
      console.error("Photo upload failed:", err);
      throw new PhotoError("We could not upload your photo. Check your connection and try again, or take the new photo back.");
    }
  }

  const pick = state.results[state.index];
  if (state.kind === "suggested" && pick) {
    if (state.uploaded && state.uploaded.key === pick.full) return state.uploaded.photo;
    showMessage(saveStatus, "Adding a photo...");
    try {
      const up = await uploadToCloudinary(pick.full, 20000);
      const photo = {
        kind: "replace",
        fields: {
          imageUrl: up.url,
          imagePublicId: up.publicId,
          imageSource: "pixabay",
          imageCredit: { name: pick.user, url: pick.pageUrl, source: "Pixabay" }
        }
      };
      state.uploaded = { key: pick.full, photo };
      return photo;
    } catch (err) {
      // It was only a suggestion. The rest of the changes are still saved.
      console.warn("The suggested photo could not be kept:", err);
      return state.hadPhoto ? { kind: "clear" } : { kind: "keep" };
    }
  }

  return { kind: "keep" };
}

async function onSubmit(event) {
  event.preventDefault();
  hideMessage(formError);

  if (DEMO) {
    showMessage(formError, "This is a preview. Nothing is saved.");
    return;
  }

  const values = formValues();
  if (values.title.length < 2) {
    showMessage(formError, "Enter the course name.");
    titleInput.focus();
    return;
  }

  if (!isDirty()) { // nothing changed, so just go back
    allowLeave = true;
    window.location.replace(courseUrl);
    return;
  }

  setSaving(true);
  try {
    const photo = await preparePhoto();
    const data = buildCourseUpdate(values, photo);
    data.updatedAt = serverTimestamp();

    showMessage(saveStatus, "Saving your changes...");
    // merge keeps everything we are not changing (the date it was created, and so on)
    await withTimeout(setDoc(courseRef, data, { merge: true }), 20000, "save-timeout");

    allowLeave = true;
    window.location.replace(courseUrl + "&saved=1");
  } catch (err) {
    if (err instanceof PhotoError) {
      showMessage(formError, err.message);
    } else if (err && err.message === "save-timeout") {
      showMessage(formError, "Saving is taking too long. Check your connection and try again.");
    } else {
      console.error("Could not save the changes:", err);
      showMessage(formError, "We could not save your changes. Please try again.");
    }
    setSaving(false);
  }
}

/* ---------- Sample data for ?demo= ---------- */
function demoCourse(kind) {
  if (kind === "notfound") return null;
  return { id: "demo", title: "Introduction to Biology", code: "BIO 101", instructor: "Dr. Smith", color: "#00D996" };
}

/* ---------- Loading ---------- */
async function load(user) {
  showView("loading");
  try {
    const found = DEMO ? demoCourse(DEMO) : await fetchCourse(user.uid, COURSE_ID);
    if (!found) {
      showView("notfound");
      return;
    }

    // The count on the example card is nice to have, so a failure here never blocks editing
    let count = null;
    if (!DEMO) {
      try {
        const all = await fetchAssignments(user.uid);
        count = all.filter((a) => a.courseId === found.id).length;
      } catch (err) {
        console.warn("Could not count assignments:", err);
      }
    } else {
      count = 0;
    }

    course = found;
    courseRef = DEMO ? null : doc(db, "users", user.uid, "courses", found.id);
    courseUrl = "course.html?id=" + encodeURIComponent(found.id);
    backLink.href = courseUrl;
    cancelLink.href = courseUrl;

    state.hadPhoto = Boolean(course.imageUrl && headerImage(course.imageUrl));
    state.currentUrl = state.hadPhoto ? course.imageUrl : "";
    state.kind = state.hadPhoto ? "current" : "none";

    fillForm();
    fillPreview(count);
    render();
    showView("page");
  } catch (err) {
    console.error("Could not load the course:", err);
    showView("error");
  }
}

/* ---------- Start ---------- */
startApp("courses", (user) => {
  form.addEventListener("submit", onSubmit);

  titleInput.addEventListener("input", () => {
    if (state.dismissed && titleInput.value.trim().toLowerCase() !== state.lastQuery) state.dismissed = false;
    scheduleSuggestion();
  });

  form.querySelectorAll('input[name="color"]').forEach((radio) => {
    radio.addEventListener("change", () => { colorName.textContent = radio.dataset.name; });
  });

  dropBtn.addEventListener("click", () => fileInput.click());
  uploadOwn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    acceptFile(fileInput.files[0]);
    fileInput.value = "";
  });

  dropBtn.addEventListener("dragover", (event) => {
    event.preventDefault();
    dropBtn.classList.add("is-dragover");
  });
  dropBtn.addEventListener("dragleave", () => dropBtn.classList.remove("is-dragover"));
  dropBtn.addEventListener("drop", (event) => {
    event.preventDefault();
    dropBtn.classList.remove("is-dragover");
    acceptFile(event.dataTransfer.files[0]);
  });

  tryAnother.addEventListener("click", () => {
    state.index = (state.index + 1) % state.results.length;
    render();
  });
  removeBtn.addEventListener("click", removePhoto);

  // Leaving with unsaved changes: ask first
  // Links, Sign out and the Back button all show our pop-up box (see leave-guard.js)
  setLeaveGuard({
    isDirty: () => Boolean(initial) && !allowLeave && isDirty(),
    onLeave: () => { allowLeave = true; },
    dialog: {
      title: "Leave without saving?",
      message: "You have changes that are not saved. If you leave now, they will be lost.",
      confirmText: "Leave",
      cancelText: "Keep editing",
      danger: true
    }
  });
  form.addEventListener("input", refreshLeaveGuard);
  form.addEventListener("change", refreshLeaveGuard);

  // Closing the tab or refreshing cannot show our box, so the browser's own message is the last safety net
  window.addEventListener("beforeunload", (event) => {
    if (!allowLeave && initial && isDirty()) {
      event.preventDefault();
      event.returnValue = "";
    }
  });

  $("edit-retry").addEventListener("click", () => load(user));
  load(user);
});