/* ==========================================================
   TRACKLY parental consent (the student's screen)
   1. The student types a parent or guardian email and ticks the box.
   2. The consent Worker emails the parent an approval link.
   3. This page asks the Worker every few seconds if the parent answered, and moves the student on:
        approved -> sign up (or, for a new Google account, finishes the account)
        declined or ran out -> start again or go home
   Nothing readable about the parent is kept: after the email is sent, only a masked form (p***@gmail.com) is remembered here.
   ========================================================== */

import { createConsentClient, consentErrorMessage } from "./consent-client.js";
import {
  readFlow, writeFlow, clearFlow, normalizeParentEmail, maskEmail, formProblems, canSendRequest, viewForStatus, POLL_MS, POLL_STOP_MS
} from "./consent-logic.js";

const $ = (id) => document.getElementById(id);
const card = $("pc-card");
const client = createConsentClient();
const store = window.sessionStorage;

let flow = readFlow(store);
let lastEmail = "";      // kept in this page's memory only, so "send again" works. It is gone when the page is closed.
let pollTimer = null;
let pollStart = 0;
let busy = false;

function setView(view) { card.dataset.view = view; card.dataset.state = view; }
const on = (el, yes) => el.classList.toggle("is-on", Boolean(yes));
const save = (patch) => { flow = { ...flow, ...patch }; writeFlow(store, flow); };

/* ---------- the form ---------- */
function refreshButton() {
  $("pc-send").classList.toggle("is-off", !canSendRequest({ email: $("parent-email").value, aware: $("parent-aware").checked, busy }));
}

function showProblems(problems) {
  on($("pc-email-error"), problems.email);
  $("parent-email").classList.toggle("is-bad", Boolean(problems.email));
  on($("pc-aware-error"), problems.aware);
  $("pc-aware-row").classList.toggle("is-bad", Boolean(problems.aware));
}

function setSending(yes) {
  busy = yes;
  card.dataset.state = yes ? "sending" : card.dataset.view;
  $("pc-send").disabled = yes;
  $("pc-resend").disabled = yes;
  refreshButton();
}

async function send() {
  const email = $("parent-email").value;
  const problems = formProblems({ email, aware: $("parent-aware").checked });
  showProblems(problems);
  on($("pc-banner"), false);
  if (problems.email || problems.aware) return;
  const clean = normalizeParentEmail(email);
  setSending(true);
  try {
    const result = await client.request(clean);
    lastEmail = clean;
    save({ requestId: result.id, parentMask: maskEmail(clean) });
    showSent();
  } catch (err) {
    $("pc-banner").textContent = consentErrorMessage(err && err.code);
    on($("pc-banner"), true);
  }
  setSending(false);
}

/* ---------- waiting for the parent ---------- */
function showSent() {
  $("pc-mask").textContent = flow.parentMask || "your parent's email";
  on($("pc-banner-sent"), false);
  setView("sent");
  startPolling();
}

function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

function startPolling() {
  stopPolling();
  pollStart = Date.now();
  $("pc-check").hidden = true;
  pollTimer = setInterval(tick, POLL_MS);
  tick();
}

async function tick() {
  if (document.hidden || !flow.requestId) return;
  if (Date.now() - pollStart > POLL_STOP_MS) { stopPolling(); $("pc-check").hidden = false; return; } // the student can tap to check again
  try {
    apply((await client.status(flow.requestId)).status);
  } catch (err) {
    // a short network problem is fine, the next check tries again
  }
}

function apply(status) {
  const view = viewForStatus(status);
  if (view === "sent") return;
  stopPolling();
  if (view !== "approved") save({ requestId: "", parentMask: "" }); // declined or ran out: a new request is needed
  if (view === "approved" && flow.finishing) $("pc-continue").textContent = "Continue";
  setView(view);
}

/* ---------- the buttons ---------- */
async function resend() {
  if (busy) return;
  if (!lastEmail) { // the page was reloaded, and we never keep the readable email: ask for it again
    save({ requestId: "", parentMask: "" });
    setView("form");
    $("parent-email").focus();
    return;
  }
  setSending(true);
  on($("pc-banner-sent"), false);
  try {
    const result = await client.request(lastEmail);
    save({ requestId: result.id });
    startPolling();
  } catch (err) {
    $("pc-banner-sent").textContent = consentErrorMessage(err && err.code);
    on($("pc-banner-sent"), true);
  }
  setSending(false);
}

function backToForm(event) {
  event.preventDefault();
  stopPolling();
  save({ requestId: "", parentMask: "" });
  setView("form");
  $("parent-email").focus();
}

async function leave(event) { // "No, take me home" and the declined screen's home button
  event.preventDefault();
  stopPolling();
  if (flow.finishing) {
    const finish = await import("./finish-signup.js");
    await finish.abandonNewAccount(await finish.currentStudent());
    return;
  }
  clearFlow(store);
  window.location.assign("index.html");
}

async function continueFinishing(event) { // only for a new Google account
  if (!flow.finishing) return; // normal sign up: the link goes to the sign up page
  event.preventDefault();
  const link = $("pc-continue");
  link.setAttribute("aria-disabled", "true");
  on($("pc-banner-claim"), false);
  try {
    const finish = await import("./finish-signup.js");
    const user = await finish.currentStudent();
    if (!user) { window.location.replace("login.html#signin"); return; }
    await finish.completeLevel(user, flow);
  } catch (err) {
    console.error("Could not finish sign up:", err);
    $("pc-banner-claim").textContent = consentErrorMessage(err && err.code);
    on($("pc-banner-claim"), true);
    link.removeAttribute("aria-disabled");
  }
}

/* ---------- start ---------- */
function init() {
  if (!flow || flow.level !== "secondary") { window.location.replace(flow && flow.finishing ? "who-are-you.html?finish=1" : "who-are-you.html"); return; }
  if (flow.finishing) $("pc-back").href = "who-are-you.html?finish=1";

  $("parent-email").addEventListener("input", () => { refreshButton(); on($("pc-email-error"), false); $("parent-email").classList.remove("is-bad"); });
  $("parent-email").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); send(); } });
  $("parent-aware").addEventListener("change", () => { refreshButton(); on($("pc-aware-error"), false); $("pc-aware-row").classList.remove("is-bad"); });
  $("pc-send").addEventListener("click", send);
  $("pc-resend").addEventListener("click", resend);
  $("pc-change").addEventListener("click", backToForm);
  $("pc-again").addEventListener("click", backToForm);
  $("pc-check").addEventListener("click", (e) => { e.preventDefault(); startPolling(); });
  $("pc-nothanks").addEventListener("click", leave);
  $("pc-home").addEventListener("click", leave);
  $("pc-home2").addEventListener("click", leave);
  $("pc-continue").addEventListener("click", continueFinishing);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && card.dataset.view === "sent") tick(); });

  refreshButton();
  if (flow.requestId) showSent(); // the student came back (or reloaded) while waiting
  else setView("form");
}
init();
