/* ==========================================================
   TRACKLY sign up page
   Connects signup.html to Firebase.
   ========================================================== */

import { signUpWithEmail, signInWithGoogle, friendlyError, DASHBOARD_URL } from "./auth.js";
import { initPasswordToggle, initStrengthMeter, showMessage, hideMessage, setBusy } from "./ui.js";
import { createConsentClient, ConsentError } from "./consent-client.js";
import { readFlow, writeFlow, clearFlow, signupGate, levelFields } from "./consent-logic.js";

const form = document.getElementById("signup-form");
const nameInput = document.getElementById("signup-name");
const emailInput = document.getElementById("signup-email");
const passwordInput = document.getElementById("signup-password");
const termsInput = document.getElementById("terms");
const submitBtn = document.getElementById("signup-submit");
const errorEl = document.getElementById("signup-error");
const googleBtn = document.getElementById("google-signup");
const strengthEl = document.getElementById("password-strength");
const strengthText = document.getElementById("strength-text");

/* ---------- Who are you? ----------
   Sign up is only for students who came through "Who are you?" (and, for secondary school students, whose parent approved).
   The choice is remembered in sessionStorage until sign up is done. */
const consent = createConsentClient();
const flowNow = readFlow(window.sessionStorage);
const gate = signupGate(flowNow);
if (gate === "check") {
  consent.status(flowNow.requestId)
    .then((result) => { if (result.status !== "approved") window.location.replace("parental-consent.html"); })
    .catch(() => { /* the Worker is checked again when the account is made */ });
} else if (gate !== "ok") {
  window.location.replace(gate);
}

/* Runs right after the account is made: confirms the approval (secondary school) and returns what is saved about the level.
   If this throws, the new account is removed again. */
async function levelFor(user) {
  const current = readFlow(window.sessionStorage);
  if (!current) throw new ConsentError("not_found");
  if (current.level === "secondary") {
    const claim = await consent.claim(current.requestId, () => user.getIdToken());
    return levelFields({ level: "secondary", approvedAt: new Date(claim.approvedAt), requestId: current.requestId });
  }
  return levelFields({ level: "higher" });
}

/* The approval could not be used: start the parent step again (the level choice stays) */
function restartConsentSoon(err) {
  const lost = err instanceof ConsentError && ["not_approved", "already_used", "not_found"].includes(err.code);
  if (!lost) return;
  const current = readFlow(window.sessionStorage);
  if (current) writeFlow(window.sessionStorage, { ...current, requestId: "", parentMask: "" });
  setTimeout(() => window.location.replace("parental-consent.html"), 3000);
}

initPasswordToggle(passwordInput, document.getElementById("toggle-password"));

initStrengthMeter(passwordInput, strengthEl, strengthText);

/* ---------- Create account ---------- */
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  hideMessage(errorEl);

  const name = nameInput.value.trim();
  const email = emailInput.value.trim();
  const password = passwordInput.value;

  if (name.length < 2) {
    showMessage(errorEl, "Enter your full name.");
    nameInput.focus();
    return;
  }
  if (!email || !emailInput.checkValidity()) {
    showMessage(errorEl, "Enter a valid email address.");
    emailInput.focus();
    return;
  }
  if (password.length < 8) {
    showMessage(errorEl, "Your password must be at least 8 characters.");
    passwordInput.focus();
    return;
  }
  if (!termsInput.checked) {
    showMessage(errorEl, "Please agree to the Terms of Service and Privacy Policy to continue.");
    termsInput.focus();
    return;
  }

  setBusy(submitBtn, true, "Creating account...");
  try {
    await signUpWithEmail({ name, email, password, beforeSave: levelFor });
    clearFlow(window.sessionStorage);
    // Step 2: go to sign in with a success note
    window.location.assign("login.html?created=1#signin");
  } catch (err) {
    showMessage(errorEl, friendlyError(err));
    restartConsentSoon(err);
    setBusy(submitBtn, false);
  }
});

/* ---------- Google ---------- */
googleBtn.addEventListener("click", async () => {
  hideMessage(errorEl);
  if (!termsInput.checked) {
    showMessage(errorEl, "Please agree to the Terms of Service and Privacy Policy to continue.");
    termsInput.focus();
    return;
  }
  googleBtn.disabled = true;
  try {
    await signInWithGoogle({ beforeSave: levelFor });
    clearFlow(window.sessionStorage);
    window.location.assign(DASHBOARD_URL);
  } catch (err) {
    const message = friendlyError(err);
    if (message) showMessage(errorEl, message);
    restartConsentSoon(err);
    googleBtn.disabled = false;
  }
});
