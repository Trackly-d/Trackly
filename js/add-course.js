/* ==========================================================
   TRACKLY Add Course page
   Saves a course to Firestore at users/{uid}/courses/{id}, then goes to My Courses.

   The course photo:
     - if the student picks their own, they see it right away (nothing is uploaded yet)
     - if they do not, we find a related photo from the course title (Pixabay, through our Worker)
     - only when they click Save is the photo uploaded to Cloudinary, so cancelling wastes nothing
   ========================================================== */

import { startApp, setLeaveGuard, refreshLeaveGuard } from "./shell.js";
import { db, collection, doc, setDoc, serverTimestamp } from "./firebase-config.js";
import { compressImage, uploadToCloudinary, fetchSuggestions, uploadsEnabled, suggestionsEnabled } from "./images.js";
import { showMessage, hideMessage } from "./ui.js";
import { isNewCourseDirty } from "./course-form.js";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const SUGGEST_DELAY_MS = 700;

const $ = (id) => document.getElementById(id);
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

const state = {
  kind: "none",     // "none", "suggested" (a photo we found) or "upload" (the student's own)
  file: null,
  objectUrl: "",
  results: [],      // suggested photos
  index: 0,         // which suggestion is showing
  loading: false,
  dismissed: false, // the student removed the suggested photo
  lastQuery: "",
  token: 0,         // lets us ignore answers that arrive late
  uploaded: null    // remembers a finished upload, so a retry does not upload twice
};

let courseRef = null; // created once, so pressing Save again never makes a second course
let allowLeave = false; // true once we are leaving on purpose (after saving, or after choosing Leave)

/* ---------- The photo box ---------- */
function render() {
  const suggestion = state.results[state.index] || null;
  let src = "";
  let info = "";

  if (state.kind === "upload") {
    src = state.objectUrl;
    info = "Your photo. It is saved with the course when you click Save Course.";
  } else if (state.kind === "suggested" && suggestion) {
    src = suggestion.preview;
    info = "Suggested photo for your course, by " + suggestion.user + " on Pixabay.";
  } else if (!state.loading) {
    info = suggestionsEnabled()
      ? "Upload your own photo. If you do not, we will find one for your course."
      : "Upload a photo for your course header. This is optional.";
  }

  preview.hidden = !src;
  if (src && preview.getAttribute("src") !== src) preview.src = src;
  emptyBox.hidden = Boolean(src) || state.loading;
  loadingBox.hidden = !state.loading || Boolean(src);
  infoText.textContent = info;
  tryAnother.hidden = !(state.kind === "suggested" && state.results.length > 1);
  removeBtn.hidden = !src;
  dropBtn.setAttribute("aria-label", src ? "Replace the course photo" : "Add a course photo");
  refreshLeaveGuard(); // the photo may have changed
}

/* Has the student typed or chosen anything yet? */
function isDirty() {
  return isNewCourseDirty({
    title: titleInput.value.trim(),
    code: codeInput.value.trim(),
    shortName: shortInput.value.trim(),
    instructor: instructorInput.value.trim(),
    color: form.querySelector('input[name="color"]:checked').value
  }, state.kind);
}

/* ---------- Suggested photos ---------- */
let suggestTimer = null;

function scheduleSuggestion() {
  clearTimeout(suggestTimer);
  if (!suggestionsEnabled() || state.kind === "upload" || state.dismissed) return;
  suggestTimer = setTimeout(runSuggestion, SUGGEST_DELAY_MS);
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
    if (token !== state.token) return; // the student kept typing or picked their own photo
    state.results = results;
    state.index = 0;
    if (state.kind !== "upload" && !state.dismissed) state.kind = results.length ? "suggested" : "none";
  } catch (err) {
    if (token !== state.token) return;
    console.warn("Could not get a suggested photo:", err);
    state.results = [];
    state.lastQuery = ""; // so the next keystroke tries again
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
  state.token += 1; // ignore any suggestion still on its way
  render();
}

function removePhoto() {
  hideMessage(imageError);
  if (state.kind === "upload") {
    URL.revokeObjectURL(state.objectUrl);
    state.objectUrl = "";
    state.file = null;
    state.uploaded = null;
    fileInput.value = "";
    state.kind = state.results.length && !state.dismissed ? "suggested" : "none";
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
  saveLabel.textContent = on ? "Saving..." : "Save Course";
  [dropBtn, uploadOwn, tryAnother, removeBtn].forEach((button) => { button.disabled = on; });
  if (!on) hideMessage(saveStatus);
}

/* Uploads the chosen photo to Cloudinary and returns the fields to save with the course */
async function preparePhoto() {
  if (state.kind === "upload" && state.file) {
    if (state.uploaded && state.uploaded.key === state.file) return state.uploaded.fields;
    showMessage(saveStatus, "Uploading your photo...");

    let blob;
    try {
      blob = await compressImage(state.file);
    } catch (err) {
      console.error("Could not shrink the photo:", err);
      throw new PhotoError("We could not read that photo. Try a different one, or remove it to save without a photo.");
    }
    try {
      const up = await uploadToCloudinary(blob);
      const fields = { imageUrl: up.url, imagePublicId: up.publicId, imageSource: "upload" };
      state.uploaded = { key: state.file, fields };
      return fields;
    } catch (err) {
      console.error("Photo upload failed:", err);
      throw new PhotoError("We could not upload your photo. Check your connection and try again, or remove the photo to save without it.");
    }
  }

  const pick = state.results[state.index];
  if (state.kind === "suggested" && pick) {
    if (state.uploaded && state.uploaded.key === pick.full) return state.uploaded.fields;
    showMessage(saveStatus, "Adding a photo...");
    try {
      const up = await uploadToCloudinary(pick.full, 20000);
      const fields = {
        imageUrl: up.url,
        imagePublicId: up.publicId,
        imageSource: "pixabay",
        imageCredit: { name: pick.user, url: pick.pageUrl, source: "Pixabay" }
      };
      state.uploaded = { key: pick.full, fields };
      return fields;
    } catch (err) {
      // It was only a suggestion, so the course is still saved, with the colored header
      console.warn("The suggested photo could not be kept, saving without it:", err);
      return {};
    }
  }

  return {};
}

async function onSubmit(event) {
  event.preventDefault();
  hideMessage(formError);

  const title = titleInput.value.trim();
  if (title.length < 2) {
    showMessage(formError, "Enter the course name.");
    titleInput.focus();
    return;
  }

  const code = codeInput.value.trim();
  const shortName = shortInput.value.trim();
  const instructor = instructorInput.value.trim();
  const color = form.querySelector('input[name="color"]:checked').value;

  setSaving(true);
  try {
    const photoFields = await preparePhoto();

    const data = { title, color, createdAt: serverTimestamp(), ...photoFields };
    if (code) data.code = code;
    if (shortName) data.shortName = shortName;
    if (instructor) data.instructor = instructor;

    showMessage(saveStatus, "Saving your course...");
    await withTimeout(setDoc(courseRef, data), 20000, "save-timeout");

    allowLeave = true;
    window.location.replace("courses.html?added=1");
  } catch (err) {
    if (err instanceof PhotoError) {
      showMessage(formError, err.message);
    } else if (err && err.message === "save-timeout") {
      showMessage(formError, "Saving is taking too long. Check your connection and try again.");
    } else {
      console.error("Could not save the course:", err);
      showMessage(formError, "We could not save your course. Please try again.");
    }
    setSaving(false);
  }
}

/* ---------- Start ---------- */
function init(user) {
  // One new course reference for this visit, so a second click on Save never makes a duplicate
  courseRef = doc(collection(db, "users", user.uid, "courses"));

  form.addEventListener("submit", onSubmit);

  // Links, Sign out and the Back button all show our pop-up box (see leave-guard.js)
  setLeaveGuard({
    isDirty: () => !allowLeave && isDirty(),
    onLeave: () => { allowLeave = true; },
    dialog: {
      title: "Leave without saving?",
      message: "This course has not been saved yet. If you leave now, what you entered will be lost.",
      confirmText: "Leave",
      cancelText: "Keep editing",
      danger: true
    }
  });
  form.addEventListener("input", refreshLeaveGuard);
  form.addEventListener("change", refreshLeaveGuard);

  // Closing the tab or refreshing cannot show our box, so the browser's own message is the last safety net
  window.addEventListener("beforeunload", (event) => {
    if (!allowLeave && isDirty()) {
      event.preventDefault();
      event.returnValue = "";
    }
  });

  titleInput.addEventListener("input", () => {
    // A new title deserves a new suggestion, even if the old one was removed
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
    fileInput.value = ""; // so choosing the same photo again still works
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

  render();
}

startApp("courses", init);