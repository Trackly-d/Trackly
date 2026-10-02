/* ==========================================================
   TRACKLY login page
   Connects login.html to Firebase.
   ========================================================== */

import { signInWithEmail, signInWithGoogle, watchAuth, friendlyError, DASHBOARD_URL } from "./auth.js";
import { initPasswordToggle, showMessage, hideMessage, setBusy } from "./ui.js";

const form = document.getElementById("signin-form");
const emailInput = document.getElementById("signin-email");
const passwordInput = document.getElementById("signin-password");
const rememberInput = document.getElementById("remember");
const submitBtn = document.getElementById("signin-submit");
const errorEl = document.getElementById("signin-error");
const noticeEl = document.getElementById("signin-notice");
const welcomeErrorEl = document.getElementById("welcome-error");

initPasswordToggle(passwordInput, document.getElementById("toggle-password"));

// True while a sign in is running, so we do not leave the page before the profile is saved.
let signingIn = false;

// Already signed in? Skip the login page.
watchAuth((user) => {
  if (user && !signingIn) window.location.replace(DASHBOARD_URL);
});

// Coming from sign up or from a password reset: show a success note.
const query = new URLSearchParams(window.location.search);
if (query.get("created") === "1") {
  showMessage(noticeEl, "Account created. Sign in to continue.");
}
if (query.get("reset") === "1") {
  showMessage(noticeEl, "Password updated. Sign in with your new password.");
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  hideMessage(errorEl);

  const email = emailInput.value.trim();
  const password = passwordInput.value;

  if (!email || !emailInput.checkValidity()) {
    showMessage(errorEl, "Enter a valid email address.");
    emailInput.focus();
    return;
  }
  if (!password) {
    showMessage(errorEl, "Enter your password.");
    passwordInput.focus();
    return;
  }

  setBusy(submitBtn, true, "Signing in...");
  signingIn = true;
  try {
    await signInWithEmail({ email, password, remember: rememberInput.checked });
    window.location.assign(DASHBOARD_URL);
  } catch (err) {
    showMessage(errorEl, friendlyError(err));
    setBusy(submitBtn, false);
    signingIn = false;
  }
});

async function handleGoogle(button, messageEl) {
  hideMessage(messageEl);
  button.disabled = true;
  signingIn = true;
  try {
    await signInWithGoogle();
    window.location.assign(DASHBOARD_URL);
  } catch (err) {
    const message = friendlyError(err);
    if (message) showMessage(messageEl, message);
    button.disabled = false;
    signingIn = false;
  }
}

const googleSignin = document.getElementById("google-signin");
const googleWelcome = document.getElementById("google-welcome");
googleSignin.addEventListener("click", () => handleGoogle(googleSignin, errorEl));
googleWelcome.addEventListener("click", () => handleGoogle(googleWelcome, welcomeErrorEl));