/* ==========================================================
   TRACKLY sign up page
   Connects signup.html to Firebase.
   ========================================================== */

import { signUpWithEmail, signInWithGoogle, friendlyError, DASHBOARD_URL } from "./auth.js";
import { initPasswordToggle, initStrengthMeter, showMessage, hideMessage, setBusy } from "./ui.js";

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
    await signUpWithEmail({ name, email, password });
    // Step 2: go to sign in with a success note
    window.location.assign("login.html?created=1#signin");
  } catch (err) {
    showMessage(errorEl, friendlyError(err));
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
    await signInWithGoogle();
    window.location.assign(DASHBOARD_URL);
  } catch (err) {
    const message = friendlyError(err);
    if (message) showMessage(errorEl, message);
    googleBtn.disabled = false;
  }
});