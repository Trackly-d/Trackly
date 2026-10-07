/* ==========================================================
   TRACKLY pop-up box (dialog)
   An in-page box that asks a question, instead of the browser's alert or confirm.
   It looks the same everywhere, works when Trackly is installed as an app (PWA),
   and works with a keyboard and a screen reader.

   Use it like this:
     const leave = await confirmDialog({
       title: "Leave without saving?",
       message: "You have changes that are not saved.",
       confirmText: "Leave",
       cancelText: "Keep editing",
       danger: true
     });
     if (leave) { ... }

   It answers true when the student picks the confirm button, and false when they
   pick the other button, press Esc, or tap outside the box.
   danger: true makes "cancelText" the big green button (the safe choice) and
   "confirmText" a quiet red one.
   ========================================================== */

import { el } from "./ui.js";

let closeCurrent = null;
let counter = 0;

export function confirmDialog({ title = "Are you sure?", message = "", confirmText = "Confirm", cancelText = "Cancel", danger = false } = {}) {
  if (closeCurrent) closeCurrent(false); // only one box at a time

  return new Promise((resolve) => {
    const previouslyFocused = document.activeElement;
    counter += 1;
    const titleId = "dialog-title-" + counter;
    const textId = "dialog-text-" + counter;

    const backdrop = el("div", "dialog-backdrop");
    const box = el("div", "dialog");
    box.setAttribute("role", "alertdialog");
    box.setAttribute("aria-modal", "true");
    box.setAttribute("aria-labelledby", titleId);
    box.setAttribute("aria-describedby", textId);

    const heading = el("h2", "", title);
    heading.id = titleId;
    const text = el("p", "", message);
    text.id = textId;

    // The safe choice is the big green button
    const cancelBtn = el("button", danger ? "btn btn-primary" : "btn btn-outline-link", cancelText);
    const confirmBtn = el("button", danger ? "btn btn-danger-outline" : "btn btn-primary", confirmText);
    cancelBtn.type = "button";
    confirmBtn.type = "button";

    const actions = el("div", "dialog-actions");
    actions.append(cancelBtn, confirmBtn);
    box.append(heading, text, actions);
    backdrop.append(box);

    const buttons = [cancelBtn, confirmBtn];

    function onKey(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        close(false);
      } else if (event.key === "Tab") {
        // Keep the keyboard inside the box
        event.preventDefault();
        const at = buttons.indexOf(document.activeElement);
        const next = event.shiftKey
          ? (at <= 0 ? buttons.length - 1 : at - 1)
          : (at === buttons.length - 1 ? 0 : at + 1);
        buttons[next].focus();
      }
    }

    const previousOverflow = document.body.style.overflow;

    function close(answer) {
      document.removeEventListener("keydown", onKey, true);
      backdrop.remove();
      document.body.style.overflow = previousOverflow;
      closeCurrent = null;
      if (previouslyFocused && typeof previouslyFocused.focus === "function") previouslyFocused.focus();
      resolve(answer);
    }
    closeCurrent = close;

    cancelBtn.addEventListener("click", () => close(false));
    confirmBtn.addEventListener("click", () => close(true));
    backdrop.addEventListener("mousedown", (event) => {
      if (event.target === backdrop) close(false); // a tap outside the box
    });
    document.addEventListener("keydown", onKey, true);

    document.body.style.overflow = "hidden"; // the page behind does not scroll
    document.body.append(backdrop);
    (danger ? cancelBtn : confirmBtn).focus(); // start on the safe choice
  });
}