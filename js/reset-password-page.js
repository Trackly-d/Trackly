/* ==========================================================
   TRACKLY reset password page (Create new password)
   The student arrives here from the link in the reset email.
   The link carries a secret code (oobCode) that Firebase checks.
   ========================================================== */

import { checkResetCode, completePasswordReset, friendlyError } from "./auth.js";
import { initPasswordToggle, initStrengthMeter, showMessage, hideMessage, setBusy } from "./ui.js";

const form = document.getElementById("reset-form");
const newInput = document.getElementById("new-password");
const confirmInput = document.getElementById("confirm-password");
const submitBtn = document.getElementById("reset-submit");
const errorEl = document.getElementById("reset-error");
const newLinkBtn = document.getElementById("request-new-link");
const strengthEl = document.getElementById("password-strength");
const strengthText = document.getElementById("strength-text");

initPasswordToggle(newInput, document.getElementById("toggle-new"));
initPasswordToggle(confirmInput, document.getElementById("toggle-confirm"));
initStrengthMeter(newInput, strengthEl, strengthText);

const params = new URLSearchParams(window.location.search);
const code = params.get("oobCode");
const mode = params.get("mode");

/* Stops the form and tells the student what happened */
function lockForm(message, offerNewLink) {
  showMessage(errorEl, message);
  newInput.disabled = true;
  confirmInput.disabled = true;
  submitBtn.disabled = true;
  newLinkBtn.hidden = !offerNewLink;
}

/* Check the link before letting the student type a new password */
async function verifyLink() {
  if (!code || (mode && mode !== "resetPassword")) {
    lockForm("This reset link is not valid. Request a new one.", true);
    return;
  }
  submitBtn.disabled = true;
  try {
    await checkResetCode(code);
    submitBtn.disabled = false;
    newInput.focus();
  } catch (err) {
    const networkProblem = err && err.code === "auth/network-request-failed";
    lockForm(friendlyError(err) + (networkProblem ? " Then refresh this page." : ""), !networkProblem);
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  hideMessage(errorEl);

  const password = newInput.value;
  if (password.length < 8) {
    showMessage(errorEl, "Your password must be at least 8 characters.");
    newInput.focus();
    return;
  }
  if (password !== confirmInput.value) {
    showMessage(errorEl, "The two passwords do not match.");
    confirmInput.focus();
    return;
  }

  setBusy(submitBtn, true, "Saving...");
  try {
    await completePasswordReset(code, password);
    window.location.assign("login.html?reset=1#signin");
  } catch (err) {
    const message = friendlyError(err);
    const linkProblem = err && (err.code === "auth/expired-action-code" || err.code === "auth/invalid-action-code");
    if (linkProblem) {
      lockForm(message, true);
    } else {
      showMessage(errorEl, message);
    }
    setBusy(submitBtn, false);
    if (linkProblem) submitBtn.disabled = true;
  }
});

verifyLink();