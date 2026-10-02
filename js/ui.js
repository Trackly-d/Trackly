/* ==========================================================
   TRACKLY small UI helpers shared by the auth pages
   ========================================================== */

const EYE = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
const EYE_OFF = '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>';

/* Eye button: shows or hides the password */
export function initPasswordToggle(input, button) {
  if (!input || !button) return;
  button.addEventListener("click", () => {
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    button.setAttribute("aria-label", show ? "Hide password" : "Show password");
    button.querySelector("svg").innerHTML = show ? EYE_OFF : EYE;
  });
}

export function showMessage(el, text) {
  if (!el) return;
  el.textContent = text;
  el.hidden = false;
}

export function hideMessage(el) {
  if (!el) return;
  el.textContent = "";
  el.hidden = true;
}

/* Disables a button while we wait for Firebase, and optionally changes its text */
export function setBusy(button, busy, busyText) {
  if (!button) return;
  if (busy) {
    button.dataset.originalText = button.textContent;
    button.disabled = true;
    if (busyText) button.textContent = busyText;
  } else {
    button.disabled = false;
    if (button.dataset.originalText) button.textContent = button.dataset.originalText;
  }
}

/* ---------- Password strength (used by sign up and reset password) ----------
   Level 0 = empty, 1 = weak, 2 = fair, 3 = strong. */
const STRENGTH_HINT = "Use at least 8 characters, with numbers and symbols";

export function checkPassword(pw) {
  if (!pw) return { level: 0, text: STRENGTH_HINT };
  if (pw.length < 8) return { level: 1, text: "Weak, use at least 8 characters" };

  const extras = [
    /\d/.test(pw),                          // has a number
    /[^A-Za-z0-9]/.test(pw),                // has a symbol
    /[a-z]/.test(pw) && /[A-Z]/.test(pw),   // has lower and upper case
    pw.length >= 12                         // is long
  ].filter(Boolean).length;

  if (extras === 0) return { level: 1, text: "Weak, add numbers and symbols" };
  if (extras === 1) return { level: 2, text: "Fair, add more variety to make it stronger" };
  return { level: 3, text: "Strong password" };
}

/* Updates the 3 bars and the text under a password box as the student types */
export function initStrengthMeter(input, strengthEl, textEl) {
  input.addEventListener("input", () => {
    const { level, text } = checkPassword(input.value);
    strengthEl.dataset.level = level;
    textEl.textContent = text;
  });
}