/* ==========================================================
   TRACKLY forgot password page
   Screen 1: student types their email and we send the reset link.
   Screen 2: "Check your email" (same page, shown with the #sent address).
   ========================================================== */

import { resetPassword, friendlyError } from "./auth.js";
import { showMessage, hideMessage, setBusy } from "./ui.js";

const form = document.getElementById("forgot-form");
const emailInput = document.getElementById("forgot-email");
const submitBtn = document.getElementById("forgot-submit");
const errorEl = document.getElementById("forgot-error");
const sentEmail = document.getElementById("sent-email");
const resendBtn = document.getElementById("resend-btn");
const resendNotice = document.getElementById("resend-notice");
const resendError = document.getElementById("resend-error");

const COOLDOWN_SECONDS = 30;
const STORAGE_KEY = "trackly_reset_email";

let currentEmail = "";
let timer = null;

/* If the page is refreshed on the "Check your email" screen, restore the email.
   If we have no email, go back to the form so nobody sees the placeholder. */
try {
  currentEmail = sessionStorage.getItem(STORAGE_KEY) || "";
} catch (err) { /* storage blocked, ignore */ }

if (window.location.hash === "#sent") {
  if (currentEmail) {
    sentEmail.textContent = currentEmail;
    startCooldown();
  } else {
    window.location.replace(window.location.pathname);
  }
}

/* Firebase says "user not found" only when email protection is off.
   We treat it like a success, so nobody can discover which emails have accounts. */
async function sendLink(email) {
  try {
    await resetPassword(email);
  } catch (err) {
    if (err && err.code === "auth/user-not-found") return;
    throw err;
  }
}

/* Resend button counts down so nobody sends many emails by accident */
function startCooldown() {
  clearInterval(timer);
  let left = COOLDOWN_SECONDS;
  resendBtn.disabled = true;
  resendBtn.textContent = "Resend link in " + left + "s";
  timer = setInterval(() => {
    left -= 1;
    if (left <= 0) {
      clearInterval(timer);
      resendBtn.disabled = false;
      resendBtn.textContent = "Resend link";
    } else {
      resendBtn.textContent = "Resend link in " + left + "s";
    }
  }, 1000);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  hideMessage(errorEl);

  const email = emailInput.value.trim();
  if (!email || !emailInput.checkValidity()) {
    showMessage(errorEl, "Enter a valid email address.");
    emailInput.focus();
    return;
  }

  setBusy(submitBtn, true, "Sending...");
  try {
    await sendLink(email);
    currentEmail = email;
    try { sessionStorage.setItem(STORAGE_KEY, email); } catch (err) { /* ignore */ }
    sentEmail.textContent = email;
    hideMessage(resendNotice);
    hideMessage(resendError);
    startCooldown();
    window.location.hash = "sent"; // shows the "Check your email" view
  } catch (err) {
    showMessage(errorEl, friendlyError(err));
  }
  setBusy(submitBtn, false);
});

resendBtn.addEventListener("click", async () => {
  if (!currentEmail) return;
  hideMessage(resendNotice);
  hideMessage(resendError);
  resendBtn.disabled = true;
  try {
    await sendLink(currentEmail);
    showMessage(resendNotice, "We sent the link again.");
    startCooldown();
  } catch (err) {
    showMessage(resendError, friendlyError(err));
    resendBtn.disabled = false;
  }
});