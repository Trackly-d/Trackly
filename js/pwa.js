/* ==========================================================
   TRACKLY app install (loaded on EVERY page, including the public ones)
   1. Registers the service worker (sw.js), which is what makes push and the offline page work.
   2. Shows the floating "Install Trackly" button when installing is possible, and hides it once Trackly is installed.
      Android, Chrome, Edge: the button opens the browser's own install box.
      iPhone and iPad: there is no install box, so the button opens a short "Add to Home Screen" guide.
   Nothing here reads or stores any student data. Its styles are in css/install.css (loaded from here, so no page needs editing).
   ========================================================== */

import { installMode } from "./pwa-logic.js";

let deferred = null;     // the browser's install box, kept until the button is tapped
let ui = null;           // the button and the guide, built the first time they are needed
let lastFocus = null;

const isStandalone = () =>
  (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || window.navigator.standalone === true;

function mode() {
  return installMode({
    ua: navigator.userAgent, platform: navigator.platform, maxTouchPoints: navigator.maxTouchPoints,
    standalone: isStandalone(), hasPrompt: Boolean(deferred)
  });
}

const ICONS = {
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  share: '<path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/>',
  plus: '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'
};
const svg = (name) => '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[name] + "</svg>";

function addStyles() {
  if (document.querySelector('link[href$="css/install.css"]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "/css/install.css";
  document.head.append(link);
}

/* The markup is fixed text that we wrote (no student data goes into it) */
function build() {
  if (ui) return ui;
  addStyles();
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ins-btn";
  button.hidden = true;
  button.setAttribute("aria-haspopup", "dialog");
  button.innerHTML = svg("download") + "Install Trackly";

  const backdrop = document.createElement("div");
  backdrop.className = "ins-backdrop";
  backdrop.hidden = true;

  const sheet = document.createElement("section");
  sheet.className = "ins-sheet";
  sheet.hidden = true;
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute("aria-labelledby", "ins-title");
  sheet.innerHTML =
    '<div class="ins-sheet-head"><h2 id="ins-title">Install Trackly on your iPhone</h2>' +
    '<button class="ins-close" type="button" aria-label="Close">' + svg("x") + "</button></div>" +
    '<p class="ins-lead">It takes three taps and gives you an icon on your Home Screen.</p>' +
    '<ol class="ins-steps">' +
    "<li><span>Open Trackly in Safari and tap <strong>Share</strong> " + svg("share") + "</span></li>" +
    "<li><span>Scroll down and tap <strong>Add to Home Screen</strong> " + svg("plus") + "</span></li>" +
    "<li><span>Tap <strong>Add</strong>, then open Trackly from its new icon</span></li></ol>" +
    '<p class="ins-note">On iPhone, alerts only work when Trackly is opened from the Home Screen icon (iOS 16.4 or newer).</p>' +
    '<button class="ins-done" type="button">Got it</button>';

  document.body.append(button, backdrop, sheet);
  ui = { button, backdrop, sheet, close: sheet.querySelector(".ins-close"), done: sheet.querySelector(".ins-done") };

  button.addEventListener("click", onButton);
  backdrop.addEventListener("click", closeSheet);
  ui.close.addEventListener("click", closeSheet);
  ui.done.addEventListener("click", closeSheet);
  document.addEventListener("keydown", (event) => {
    if (sheet.hidden) return;
    if (event.key === "Escape") closeSheet();
    if (event.key === "Tab") { // keep the keyboard inside the guide while it is open
      const first = ui.close, last = ui.done;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  return ui;
}

function openSheet() {
  lastFocus = document.activeElement;
  ui.sheet.hidden = false;
  ui.backdrop.hidden = false;
  ui.done.focus();
}

function closeSheet() {
  if (!ui || ui.sheet.hidden) return;
  ui.sheet.hidden = true;
  ui.backdrop.hidden = true;
  if (lastFocus && lastFocus.focus) lastFocus.focus();
}

async function onButton() {
  if (deferred) {
    const box = deferred;
    deferred = null; // the browser allows one use of its install box
    try {
      box.prompt();
      await box.userChoice;
    } catch (err) {
      console.error("Install box problem:", err);
    }
    refresh();
    return;
  }
  if (mode() === "ios") openSheet();
}

function refresh() {
  const current = mode();
  if (current === "prompt" || current === "ios") build().button.hidden = false;
  else if (ui) { ui.button.hidden = true; closeSheet(); }
}

/* ---------- start ---------- */
function registerWorker() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((err) => console.error("Service worker problem:", err));
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault(); // we show our own button instead of the browser's small bar
  deferred = event;
  refresh();
});
window.addEventListener("appinstalled", () => { deferred = null; refresh(); });

if (document.readyState === "complete") registerWorker();
else window.addEventListener("load", registerWorker);
refresh();
