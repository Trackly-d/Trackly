/* ==========================================================
   TRACKLY Settings page
   Account links, in-app alert settings, About links, and Delete account.

   Profile and Change Password open on the Profile page. Google Calendar and reminders stay on Profile.
   Alert settings are saved on the student's record: alertsEnabled, alertHours (3, 24 and 48 are allowed, several at once).

   DELETE ACCOUNT, in this order (js/account-delete.js): check the sign in again, remove Google Calendar reminders,
   remove photos (through the image Worker), delete courses, assignments and the rest, delete the login last.
   Any step can be run again, so a problem never traps the student.

   Design views (no data is read):  settings.html?state=loading | ?state=error
   ========================================================== */

import { startApp, showToast } from "./shell.js";
import {
  db, doc, collection, getDoc, getDocs, query, limit, deleteDoc, deleteUser,
  reauthenticateWithCredential, reauthenticateWithPopup, EmailAuthProvider, GoogleAuthProvider
} from "./firebase-config.js";
import { fetchAlertSettings, saveAlertSettings } from "./notifications-data.js";
import { validateAlertSettings } from "./notifications-logic.js";
import { invalidateCache, clearAllCache } from "./cache.js";
import { showMessage, hideMessage } from "./ui.js";
import { passwordMode } from "./profile-rules.js";
import { deleteAccount, deleteMessage, validateDeleteForm, DELETE_COLLECTIONS } from "./account-delete.js";
import { createCalendarClient } from "./calendar-client.js";
import { createImageDeleter, collectImageIds } from "./image-delete.js";
import { IMAGE_WORKER_URL } from "./images.js";
import { APP_VERSION, BUILD_MONTH } from "./app-info.js";

const STATE = new URLSearchParams(window.location.search).get("state");
const $ = (id) => document.getElementById(id);
const views = { loading: $("st-loading"), error: $("st-error"), page: $("st-page") };
const timingBoxes = () => Array.from(document.querySelectorAll('input[name="timing"]'));

let user = null;
let uid = "";
let settings = { alertsEnabled: true, alertHours: [48, 24] };
let busy = false;
let deleting = false;
let deleteMode = "change";

const calendarClient = createCalendarClient({ getToken: () => user.getIdToken() });
const imageDeleter = createImageDeleter({ workerUrl: IMAGE_WORKER_URL, getToken: () => user.getIdToken() });

function show(name) {
  Object.keys(views).forEach((key) => { views[key].hidden = key !== name; });
}

/* ---------- Drawing ---------- */
function draw() {
  $("st-email").textContent = user.email || "";
  $("st-password-sub").textContent = passwordMode(user.providerData) === "set"
    ? "Add a password so you can also sign in with your email"
    : "Update the password you sign in with";
  $("st-version").textContent = "v" + APP_VERSION;
  $("st-build").textContent = BUILD_MONTH;
  $("st-alerts").checked = settings.alertsEnabled;
  timingBoxes().forEach((box) => { box.checked = settings.alertHours.includes(Number(box.value)); });
}

/* ---------- Alert settings ---------- */
async function onAlertChange(event) {
  const target = event.target;
  if (busy) { draw(); return; }
  const alertHours = timingBoxes().filter((box) => box.checked).map((box) => Number(box.value));
  const check = validateAlertSettings({ alertsEnabled: $("st-alerts").checked, alertHours });
  hideMessage($("st-timing-error"));

  if (!check.ok) {
    showMessage($("st-timing-error"), check.error);
    if (target.name === "timing") target.checked = true; // keep at least one
    else target.checked = false;                          // the switch cannot go on with nothing chosen
    return;
  }

  busy = true;
  try {
    await saveAlertSettings(uid, check.value);
    settings = check.value;
    invalidateCache(uid); // so the bell and the Notifications page use the new choice
  } catch (err) {
    console.error("Could not save the alert settings:", err);
    showToast("Could not save. Check your connection.");
    draw();
  }
  busy = false;
}

/* ---------- Delete account ---------- */
function setDeleting(on) {
  deleting = on;
  ["del-password", "del-type", "del-cancel", "del-confirm", "del-close"].forEach((id) => { $(id).disabled = on; });
  $("del-progress").hidden = !on;
}

function openDelete() {
  deleteMode = passwordMode(user.providerData);
  $("del-password-field").hidden = deleteMode === "set";
  $("del-google-note").hidden = deleteMode !== "set";
  $("del-form").reset();
  hideMessage($("del-error"));
  setDeleting(false);
  $("del-modal").hidden = false;
  (deleteMode === "set" ? $("del-type") : $("del-password")).focus();
}

function closeDelete() {
  if (deleting) return; // never close in the middle of deleting
  $("del-modal").hidden = true;
  $("st-delete").focus();
}

async function readUserDoc() {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? snap.data() : {};
}

async function wipeData() {
  for (const name of DELETE_COLLECTIONS) {
    for (let round = 0; round < 200; round++) {
      const snap = await getDocs(query(collection(db, "users", uid, name), limit(100)));
      if (snap.empty) break;
      await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
    }
  }
  await deleteDoc(doc(db, "users", uid));
}

async function onDeleteSubmit(event) {
  event.preventDefault();
  if (deleting) return;
  hideMessage($("del-error"));

  const values = { typed: $("del-type").value, password: $("del-password").value };
  const check = validateDeleteForm(values, deleteMode);
  if (!check.ok) {
    showMessage($("del-error"), check.error);
    $(check.field === "typed" ? "del-type" : "del-password").focus();
    return;
  }

  setDeleting(true);
  try {
    await deleteAccount({
      onProgress: (text) => { $("del-progress").textContent = text; },
      deps: {
        reauth: () => (deleteMode === "change"
          ? reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, values.password))
          : reauthenticateWithPopup(user, new GoogleAuthProvider())),
        removeCalendar: async () => {
          const record = await readUserDoc();
          if (record.calendar && record.calendar.connected) await calendarClient.disconnect(); // removes the reminders, revokes access
        },
        removePhotos: async () => {
          const [courses, record] = await Promise.all([
            getDocs(collection(db, "users", uid, "courses")),
            readUserDoc()
          ]);
          const ids = collectImageIds({
            courses: courses.docs.map((d) => d.data()),
            customPhotoPublicId: record.customPhotoPublicId,
            customPhotoURL: record.customPhotoURL
          });
          await imageDeleter.deleteImages(ids);
        },
        removeData: wipeData,
        removeLogin: () => deleteUser(user)
      }
    });
    clearAllCache();
    window.location.replace("index.html"); // the login is gone, so this is a public page
  } catch (err) {
    console.error("Could not delete the account:", err);
    setDeleting(false);
    const message = deleteMessage(err);
    if (message) showMessage($("del-error"), message);
  }
}

/* ---------- The left list shows where you are ---------- */
function watchSections() {
  const links = Array.from(document.querySelectorAll(".st-nav a"));
  const setActive = (id) => links.forEach((link) => link.classList.toggle("is-active", link.getAttribute("href") === "#" + id));
  links.forEach((link) => link.addEventListener("click", () => setActive(link.getAttribute("href").slice(1))));
  if (!("IntersectionObserver" in window)) return;
  const observer = new IntersectionObserver((entries) => {
    const seen = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
    if (seen) setActive(seen.target.id);
  }, { rootMargin: "-20% 0px -60% 0px" });
  ["account", "notifications", "about"].forEach((id) => observer.observe($(id)));
}

/* ---------- Loading ---------- */
async function load() {
  show("loading");
  try {
    settings = await fetchAlertSettings(uid);
  } catch (err) {
    console.error("Could not load the settings:", err);
    show("error");
    return;
  }
  draw();
  show("page");
}

/* ---------- Start ---------- */
function init(signedIn) {
  user = signedIn;
  uid = user.uid;
  if (views[STATE] && STATE !== "page") { show(STATE); return; }

  $("st-alerts").addEventListener("change", onAlertChange);
  timingBoxes().forEach((box) => box.addEventListener("change", onAlertChange));
  $("st-logout").addEventListener("click", () => $("signout").click()); // same as the sidebar: it asks first if there are unsaved changes

  $("st-delete").addEventListener("click", openDelete);
  ["del-close", "del-cancel", "del-backdrop"].forEach((id) => $(id).addEventListener("click", closeDelete));
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !$("del-modal").hidden) closeDelete(); });
  $("del-form").addEventListener("submit", onDeleteSubmit);

  $("st-retry").addEventListener("click", load);
  watchSections();
  load();
}

startApp("settings", init);