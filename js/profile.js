/* ==========================================================
   TRACKLY Profile page
   Shows the student's account and lets them change their name, photo and password,
   switch assignment reminders on or off, and log out.

   Reads: one document, users/{uid} (repaired quietly if it is missing).
   Writes: users/{uid} only: fullName, customPhotoURL, remindersEnabled.
   The name and photo are also saved on the sign in account (displayName, photoURL), so the sidebar
   shows them on every page without another read.

   Photo order: own upload, then Google photo, then initials. Removing the own photo goes back to Google or initials.
   Google Calendar: Connect, Disconnect and Reconnect go through the calendar Worker (js/calendar-client.js).
   The Worker is the truth. users/{uid}.calendar is only a display hint, fixed on every visit if it disagrees.
   No Google token ever reaches the browser or Firestore, and nothing important is saved in the browser.

   Design views (no data is read):  profile.html?state=loading | ?state=error
   and for the "add reminders to existing assignments" row: ?state=backfill | backfill-working | backfill-done | backfill-problem
   ========================================================== */

import { startApp, showToast, refreshUser } from "./shell.js";
import {
  db, doc, updateDoc, deleteField, serverTimestamp, updateProfile, updatePassword,
  reauthenticateWithCredential, reauthenticateWithPopup, linkWithCredential,
  EmailAuthProvider, GoogleAuthProvider
} from "./firebase-config.js";
import { ensureUserProfile, fetchUserRecord } from "./users.js";
import { resetPassword, friendlyError } from "./auth.js";
import { compressImage, uploadToCloudinary, uploadsEnabled } from "./images.js";
import { confirmDialog } from "./dialog.js";
import { showMessage, hideMessage } from "./ui.js";
import { createCalendarClient, calendarErrorMessage } from "./calendar-client.js";
import {
  validateName, initialsOf, googlePhotoOf, photoToShow, passwordMode, validatePasswordForm,
  passwordError, memberSinceText, validatePhotoFile, calendarReturn, reconcileCalendar
} from "./profile-rules.js";
import { listCleanup, finishCleanup, clearAllCleanup, saveCalendarField } from "./calendar-store.js";
import { runCleanup } from "./calendar-sync.js";
import { planBackfill, runBackfill, backfillMessage } from "./calendar-backfill.js";
import { fetchUpcomingAssignments } from "./assignments-data.js";
import { fetchCourses } from "./courses-data.js";
import { invalidateCache } from "./cache.js";

const SAVE_LIMIT_MS = 20000;
const STATE = new URLSearchParams(window.location.search).get("state");
const $ = (id) => document.getElementById(id);
const views = { loading: $("pf-loading"), error: $("pf-error"), page: $("pf-page") };

let user = null;
let userRef = null;
let record = {};          // users/{uid}
let pwMode = "change";    // "change" or "set"
let pendingPhoto = null;  // a chosen photo, not saved yet
let pendingUrl = "";
let busy = false;
let pwOpener = null;
let calState = "off";     // "on", "off", "reconnect" or "connecting" (busy)
const client = createCalendarClient({ getToken: () => user.getIdToken() });
const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
let backfilling = false;

function show(name) {
  Object.keys(views).forEach((key) => { views[key].hidden = key !== name; });
}

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error("save-timeout")), ms))]);
}

function toJsDate(value) {
  if (value && typeof value.toDate === "function") return value.toDate();
  return value instanceof Date ? value : null;
}

/* ---------- Drawing ---------- */
function currentName() {
  return user.displayName || record.fullName || (user.email ? user.email.split("@")[0] : "Student");
}

function paintPhoto() {
  const img = $("pf-photo");
  const src = pendingUrl || photoToShow({ custom: record.customPhotoURL, google: googlePhotoOf(user.providerData) });
  if (src) {
    img.src = src;
    img.hidden = false;
    $("pf-initials").hidden = true;
  } else {
    img.removeAttribute("src");
    img.hidden = true;
    $("pf-initials").hidden = false;
  }
}

function draw() {
  const name = currentName();
  $("pf-name").textContent = name;
  $("pf-name-row").textContent = name;
  $("pf-email").textContent = user.email || "";
  $("pf-email-row").textContent = user.email || "";
  $("pf-initials").textContent = initialsOf(name, user.email);
  $("pf-verified").hidden = !user.emailVerified;
  $("pf-since").textContent = memberSinceText(toJsDate(record.createdAt) || new Date(user.metadata.creationTime));
  paintPhoto();
  $("photo-remove").hidden = !record.customPhotoURL || Boolean(pendingPhoto);

  pwMode = passwordMode(user.providerData);
  $("password-title").textContent = pwMode === "set" ? "Set a Password" : "Change Password";
  $("password-sub").textContent = pwMode === "set"
    ? "Add a password so you can also sign in with your email"
    : "Update the password you sign in with";

  $("reminders-toggle").checked = record.remindersEnabled !== false;
}

/* ---------- Name ---------- */
function openName() {
  $("name-row").hidden = true;
  $("name-form").hidden = false;
  hideMessage($("name-error"));
  $("name-input").value = currentName();
  $("name-input").focus();
  $("name-input").select();
}

function closeName() {
  $("name-form").hidden = true;
  $("name-row").hidden = false;
}

async function onNameSubmit(event) {
  event.preventDefault();
  if (busy) return;
  const check = validateName($("name-input").value);
  hideMessage($("name-error"));
  $("name-input").classList.toggle("is-invalid", !check.ok);
  if (!check.ok) { showMessage($("name-error"), check.error); $("name-input").focus(); return; }
  if (check.name === currentName()) { closeName(); return; }

  busy = true;
  $("name-save").disabled = true;
  try {
    await withTimeout(updateProfile(user, { displayName: check.name }), SAVE_LIMIT_MS);
    await withTimeout(updateDoc(userRef, { fullName: check.name }), SAVE_LIMIT_MS);
    record.fullName = check.name;
    refreshUser(user);
    draw();
    closeName();
    showToast("Name updated");
  } catch (err) {
    console.error("Could not save the name:", err);
    showMessage($("name-error"), "We could not save your name. Check your connection and try again.");
  }
  busy = false;
  $("name-save").disabled = false;
}

/* ---------- Photo ---------- */
function clearPending() {
  if (pendingUrl) URL.revokeObjectURL(pendingUrl);
  pendingPhoto = null;
  pendingUrl = "";
  $("photo-bar").hidden = true;
}

async function onPhotoChosen() {
  const input = $("photo-input");
  const file = input.files && input.files[0];
  input.value = "";
  if (!file) return;
  hideMessage($("pf-msg"));

  const problem = validatePhotoFile(file);
  if (problem) { showMessage($("pf-msg"), problem); return; }
  try {
    const blob = await compressImage(file, 512, 0.85);
    clearPending();
    pendingPhoto = blob;
    pendingUrl = URL.createObjectURL(blob);
    $("photo-bar").hidden = false;
    draw();
  } catch (err) {
    console.error("Could not read the photo:", err);
    showMessage($("pf-msg"), "We could not read that photo. Try a different one.");
  }
}

async function onPhotoSave() {
  if (busy || !pendingPhoto) return;
  busy = true;
  $("photo-save").disabled = true;
  hideMessage($("pf-msg"));
  try {
    const uploaded = await uploadToCloudinary(pendingPhoto);
    await withTimeout(updateDoc(userRef, { customPhotoURL: uploaded.url }), SAVE_LIMIT_MS);
    await withTimeout(updateProfile(user, { photoURL: uploaded.url }), SAVE_LIMIT_MS);
    record.customPhotoURL = uploaded.url;
    clearPending();
    refreshUser(user);
    draw();
    showToast("Photo updated");
  } catch (err) {
    console.error("Could not save the photo:", err);
    showMessage($("pf-msg"), "We could not save your photo. Check your connection and try again.");
  }
  busy = false;
  $("photo-save").disabled = false;
}

function onPhotoCancel() {
  clearPending();
  draw();
}

async function onPhotoRemove() {
  if (busy) return;
  const google = googlePhotoOf(user.providerData);
  const yes = await confirmDialog({
    title: "Remove your photo?",
    message: google ? "Your Google photo will show instead." : "Your initials will show instead.",
    confirmText: "Remove",
    cancelText: "Keep it",
    danger: true
  });
  if (!yes) return;

  busy = true;
  hideMessage($("pf-msg"));
  try {
    await withTimeout(updateDoc(userRef, { customPhotoURL: deleteField() }), SAVE_LIMIT_MS);
    await withTimeout(updateProfile(user, { photoURL: google || null }), SAVE_LIMIT_MS);
    delete record.customPhotoURL;
    refreshUser(user);
    draw();
    showToast("Photo removed");
  } catch (err) {
    console.error("Could not remove the photo:", err);
    showMessage($("pf-msg"), "We could not remove your photo. Check your connection and try again.");
  }
  busy = false;
}

/* ---------- Password ---------- */
function openPassword() {
  pwMode = passwordMode(user.providerData);
  const set = pwMode === "set";
  pwOpener = document.activeElement;
  $("pw-title").textContent = set ? "Set a Password" : "Change Password";
  $("pw-current-field").hidden = set;
  $("pw-form").reset();
  document.querySelectorAll("[data-eye]").forEach((button) => setEye(button, false));
  hideMessage($("pw-error"));
  $("pw-modal").hidden = false;
  (set ? $("pw-new") : $("pw-current")).focus();
}

function closePassword() {
  $("pw-modal").hidden = true;
  $("pw-form").reset();
  if (pwOpener && pwOpener.focus) pwOpener.focus();
}

function setEye(button, visible) {
  $(button.dataset.eye).type = visible ? "text" : "password";
  button.setAttribute("aria-pressed", String(visible));
  button.setAttribute("aria-label", visible ? "Hide password" : "Show password");
}

async function onPasswordSubmit(event) {
  event.preventDefault();
  if (busy) return;
  hideMessage($("pw-error"));

  const values = { current: $("pw-current").value, next: $("pw-new").value, confirm: $("pw-confirm").value };
  const check = validatePasswordForm(values, pwMode);
  if (!check.ok) {
    showMessage($("pw-error"), check.error);
    $(check.field === "next" ? "pw-new" : "pw-" + check.field).focus();
    return;
  }

  busy = true;
  $("pw-save").disabled = true;
  $("pw-save").textContent = "Saving...";
  try {
    if (pwMode === "change") {
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, values.current));
      await updatePassword(user, values.next);
    } else {
      // Google only account: sign in with Google once more, then add an email and password to the same account
      await reauthenticateWithPopup(user, new GoogleAuthProvider());
      await linkWithCredential(user, EmailAuthProvider.credential(user.email, values.next));
    }
    const wasSet = pwMode === "set";
    closePassword();
    draw();
    showToast(wasSet ? "Password set. You can now sign in with your email too." : "Password changed");
  } catch (err) {
    const message = passwordError(err && err.code) || friendlyError(err); // "" when the student just closed the Google window
    if (message) showMessage($("pw-error"), message);
  }
  busy = false;
  $("pw-save").disabled = false;
  $("pw-save").textContent = "Save Changes";
}

async function onForgot() {
  if (busy || !user.email) return;
  busy = true;
  hideMessage($("pw-error"));
  try {
    await resetPassword(user.email);
    showToast("We sent a reset link to " + user.email);
  } catch (err) {
    showMessage($("pw-error"), friendlyError(err) || "We could not send the email. Please try again.");
  }
  busy = false;
}

/* ---------- Reminders switch ---------- */
async function onRemindersChange() {
  const on = $("reminders-toggle").checked;
  try {
    await withTimeout(updateDoc(userRef, { remindersEnabled: on }), SAVE_LIMIT_MS);
    record.remindersEnabled = on;
    showToast(on ? "Reminders on for new assignments" : "Reminders off for new assignments");
  } catch (err) {
    console.error("Could not save the reminders choice:", err);
    $("reminders-toggle").checked = !on;
    showToast("Could not save. Check your connection.");
  }
}

/* ---------- Google Calendar ---------- */
/* text: the line shown while busy. on: where the switch sits. */
function setCal(state, { text = "", on = state === "on" } = {}) {
  calState = state;
  $("cal-row").dataset.state = state;
  $("backfill-row").hidden = state !== "on"; // "add reminders to existing assignments" needs a working connection
  if (state !== "on") setBackfill("idle");
  $("cal-toggle").checked = on;
  $("cal-toggle").disabled = state === "connecting";
  if (text) $("cal-connecting-text").textContent = text;
}

async function connectCalendar() {
  if (calState === "connecting") return;
  const before = calState;
  hideMessage($("pf-msg"));
  setCal("connecting", { text: "Opening Google...", on: true });
  try {
    window.location.assign(await client.startConnect()); // Google asks, then sends the student back here
  } catch (err) {
    console.error("Could not start the Google connection:", err);
    setCal(before);
    showMessage($("pf-msg"), calendarErrorMessage(err && err.code));
  }
}

async function disconnectCalendar() {
  const yes = await confirmDialog({
    title: "Turn off Google Calendar Reminders?",
    message: "Trackly will remove the reminders it added to your calendar and stop adding new ones. Your assignments are not affected.",
    confirmText: "Turn off",
    cancelText: "Keep on",
    danger: true
  });
  if (!yes) return;

  hideMessage($("pf-msg"));
  setCal("connecting", { text: "Removing your reminders...", on: false });
  try {
    const result = await client.disconnect({
      onProgress: (n) => { $("cal-connecting-text").textContent = "Removing your reminders... " + n + " removed"; }
    });
    try { // only a display hint: if this fails, the next visit fixes it
      await withTimeout(updateDoc(userRef, { calendar: deleteField() }), SAVE_LIMIT_MS);
      delete record.calendar;
    } catch (err) { console.error("Could not clear the calendar hint:", err); }
    try { await clearAllCleanup(user.uid); } catch (err) { console.error("Could not clear queued removals:", err); } // Disconnect removed every Trackly event
    setCal("off");
    showToast(result.unreachable
      ? "Disconnected. Reminders already in your calendar can be deleted there."
      : "Google Calendar reminders turned off");
  } catch (err) {
    console.error("Could not turn off Google Calendar:", err);
    setCal("on");
    showMessage($("pf-msg"), calendarErrorMessage(err && err.code) + " Google Calendar stays connected.");
  }
}

function onCalendarToggle(event) {
  event.preventDefault(); // the page sets the switch itself, once it knows what really happened
  if (busy || calState === "connecting") return;
  return calState === "on" ? disconnectCalendar() : connectCalendar();
}

/* ---------- Add reminders to existing assignments ---------- */
function setBackfill(state, text = "") {
  $("backfill-row").dataset.state = state; // "idle", "working", "done" or "problem"
  if (text && state !== "idle") $("backfill-" + state).textContent = text;
  $("backfill-btn").disabled = state === "working";
}

async function onBackfill() {
  if (backfilling || busy || calState !== "on") return;
  backfilling = true;
  hideMessage($("pf-msg"));
  setBackfill("working", "Looking at your assignments...");
  try {
    const now = new Date();
    const [items, courseList] = await Promise.all([
      fetchUpcomingAssignments(user.uid, now),
      fetchCourses(user.uid).catch(() => []) // reminders still work without course names
    ]);
    const names = new Map(courseList.map((course) => [course.id, course.title]));
    const plan = planBackfill({ items, now, timeZone: TIME_ZONE, courseName: (courseId) => names.get(courseId) || "" });

    let result = { added: 0, stopped: null };
    if (plan.jobs.length) {
      result = await runBackfill({
        client,
        jobs: plan.jobs,
        saveEvents: (job, events) => saveCalendarField(doc(db, "users", user.uid, "assignments", job.item.id), events, TIME_ZONE),
        onProgress: (n, total) => { $("backfill-working").textContent = "Adding reminders... " + n + " of " + total; }
      });
    }
    invalidateCache(user.uid); // so an assignment page opened next shows its new reminders
    const message = backfillMessage({ added: result.added, skipped: plan.skipped, remaining: plan.remaining, stopped: result.stopped });
    setBackfill(message.kind, message.text);
    if (message.kind === "done" && result.added) showToast("Reminders added");
  } catch (err) {
    console.error("Could not add reminders to existing assignments:", err);
    setBackfill("problem", "We could not read your assignments. Check your connection and try again.");
  }
  backfilling = false;
}

/* Calendar removals that could not be finished earlier (for example after Submitted while offline) */
async function finishQueuedRemovals() {
  try {
    const items = await listCleanup(user.uid);
    if (!items.length) return;
    const done = await runCleanup({ client, items, finish: (itemId) => finishCleanup(user.uid, itemId) });
    if (done) showToast("Old reminders removed from your calendar");
  } catch (err) {
    console.error("Could not finish the queued removals:", err);
  }
}

/* On every visit: show what we last knew, ask the Worker what is true, and fix the hint if needed */
async function initCalendar() {
  const hinted = Boolean(record.calendar && record.calendar.connected);
  setCal(hinted ? "on" : "off");

  const params = new URLSearchParams(window.location.search);
  const back = calendarReturn(params.get("calendar"));
  if (params.has("calendar")) {
    params.delete("calendar");
    const rest = params.toString();
    window.history.replaceState(null, "", window.location.pathname + (rest ? "?" + rest : ""));
  }
  if (back && back.kind === "problem") showMessage($("pf-msg"), back.message);

  try {
    const plan = reconcileCalendar(hinted, (await client.status()).status);
    setCal(plan.state);
    try {
      if (plan.flag === "set") {
        await withTimeout(updateDoc(userRef, { calendar: { connected: true, connectedAt: serverTimestamp() } }), SAVE_LIMIT_MS);
        record.calendar = { connected: true };
      }
      if (plan.flag === "clear") {
        await withTimeout(updateDoc(userRef, { calendar: deleteField() }), SAVE_LIMIT_MS);
        delete record.calendar;
      }
    } catch (err) { console.error("Could not update the calendar hint:", err); }
    if (back && back.kind === "ok" && plan.state === "on") {
      showToast(back.message);
      showMessage($("pf-msg"), "Connected. Add reminders to your existing assignments? Use the button in the Preferences card below.");
    }
    if (plan.state === "on") await finishQueuedRemovals();
  } catch (err) {
    console.error("Could not check Google Calendar:", err);
    if (back && back.kind === "ok") showMessage($("pf-msg"), "Google Calendar was connected, but we could not confirm it. Reload the page in a moment.");
  }
}

/* ---------- Loading ---------- */
async function load() {
  show("loading");
  try {
    await ensureUserProfile(user);
    record = (await fetchUserRecord(user.uid)) || {};
  } catch (err) {
    console.error("Could not load the profile:", err);
    show("error");
    return;
  }
  draw();
  show("page");
  initCalendar(); // handles its own problems, the rest of the page works without it
}

/* ---------- Start ---------- */
function init(signedIn) {
  user = signedIn;
  userRef = doc(db, "users", user.uid);

  // Design review views, no data is read
  if (STATE && STATE.startsWith("backfill")) {
    show("page");
    $("backfill-row").hidden = false;
    $("backfill-row").dataset.state = STATE.slice("backfill-".length) || "idle";
    $("backfill-btn").disabled = $("backfill-row").dataset.state === "working";
    return;
  }
  if (views[STATE] && STATE !== "page") { show(STATE); return; }

  $("pf-photo").referrerPolicy = "no-referrer"; // lets Google profile photos load
  $("pf-photo").addEventListener("error", () => { $("pf-photo").hidden = true; $("pf-initials").hidden = false; });

  $("edit-profile").addEventListener("click", openName);
  $("name-edit").addEventListener("click", openName);
  $("name-cancel").addEventListener("click", closeName);
  $("name-form").addEventListener("submit", onNameSubmit);

  $("camera-btn").addEventListener("click", () => {
    if (!uploadsEnabled()) { showToast("Photo upload is not set up yet"); return; }
    $("photo-input").click();
  });
  $("photo-input").addEventListener("change", onPhotoChosen);
  $("photo-save").addEventListener("click", onPhotoSave);
  $("photo-cancel").addEventListener("click", onPhotoCancel);
  $("photo-remove").addEventListener("click", onPhotoRemove);

  $("password-open").addEventListener("click", openPassword);
  ["pw-close", "pw-cancel", "pw-backdrop"].forEach((id) => $(id).addEventListener("click", closePassword));
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !$("pw-modal").hidden) closePassword(); });
  document.querySelectorAll("[data-eye]").forEach((button) => {
    button.addEventListener("click", () => setEye(button, button.getAttribute("aria-pressed") !== "true"));
  });
  $("pw-form").addEventListener("submit", onPasswordSubmit);
  $("pw-forgot").addEventListener("click", onForgot);

  $("reminders-toggle").addEventListener("change", onRemindersChange);

  $("cal-toggle").addEventListener("click", onCalendarToggle);
  $("cal-reconnect").addEventListener("click", connectCalendar);
  $("backfill-btn").addEventListener("click", onBackfill);

  // Same as the sidebar Sign out (it asks first if a form has unsaved changes)
  $("logout-btn").addEventListener("click", () => $("signout").click());

  $("pf-retry").addEventListener("click", load);
  load();
}

startApp("profile", init);