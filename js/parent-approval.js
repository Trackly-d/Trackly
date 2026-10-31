/* ==========================================================
   TRACKLY parent approval (the parent's screen, opened from the email link)
   The link holds a secret code (?token=). This page asks the consent Worker if the code is still good, and sends the parent's
   answer. It never shows anything about the student, because we do not hold anything until the parent approves.
   ========================================================== */

import { createConsentClient, consentErrorMessage } from "./consent-client.js";

const $ = (id) => document.getElementById(id);
const card = $("pa-card");
const client = createConsentClient();
const token = new URLSearchParams(window.location.search).get("token") || "";
let busy = false;

const setView = (view) => { card.dataset.view = view; card.dataset.state = view; };
const on = (el, yes) => el.classList.toggle("is-on", Boolean(yes));

/* What each status means for the parent */
function showStatus(status) {
  if (status === "pending") setView("ready");
  else if (status === "approved") setView("approved");
  else if (status === "declined") setView("declined");
  else setView("expired"); // ran out, already used, or not a real link
}

function setBusy(yes) {
  busy = yes;
  card.dataset.state = yes ? "approving" : card.dataset.view;
  $("pa-approve").disabled = yes;
  $("pa-decline").disabled = yes;
}

async function answer(decision) {
  if (busy) return;
  on($("pa-banner"), false);
  if (decision === "approve" && !$("parent-confirm").checked) {
    on($("pa-confirm-error"), true);
    $("pa-confirm-row").classList.add("is-bad");
    return;
  }
  setBusy(true);
  try {
    showStatus((await client.answer(token, decision)).status);
  } catch (err) {
    $("pa-banner").textContent = consentErrorMessage(err && err.code);
    on($("pa-banner"), true);
  }
  setBusy(false);
}

async function init() {
  $("parent-confirm").addEventListener("change", () => { on($("pa-confirm-error"), false); $("pa-confirm-row").classList.remove("is-bad"); });
  $("pa-approve").addEventListener("click", () => answer("approve"));
  $("pa-decline").addEventListener("click", () => answer("decline"));
  if (!token) { setView("expired"); return; }
  try {
    showStatus((await client.lookup(token)).status);
  } catch (err) {
    setView("ready");
    $("pa-banner").textContent = consentErrorMessage(err && err.code);
    on($("pa-banner"), true);
  }
}
init();
