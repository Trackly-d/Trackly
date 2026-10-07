/* ==========================================================
   TRACKLY leave guard
   Stops a student from losing unsaved work by accident.
   A page that has a form switches it on, and from then on, if the form has
   changes, any way of leaving shows our pop-up box (see dialog.js):
     - tapping a link, including the sidebar
     - Sign out
     - the browser's Back button or the phone's Back gesture (also inside an installed app)

   What nothing can intercept: closing the tab, refreshing, or swiping the app away.
   Browsers only allow their own generic message there, so pages keep that as a last safety net.

   A page uses it like this:
     setLeaveGuard({
       isDirty: () => formHasChanges,
       onLeave: () => { ...called when the student chooses to leave... },
       dialog: { title, message, confirmText, cancelText, danger }
     });
     refreshLeaveGuard();   // call it whenever the form changes
   ========================================================== */

import { confirmDialog } from "./dialog.js";

let guard = null;
let barrier = false; // an extra history step that catches the Back button
let installed = false;

export function setLeaveGuard(options) {
  guard = options || null;
}

function isActive() {
  return Boolean(guard && guard.isDirty());
}

/* Call this whenever the form changes. The first time it has changes,
   we add the extra history step, so Back asks first instead of leaving. */
export function refreshLeaveGuard() {
  if (isActive() && !barrier) {
    window.history.pushState({ leaveGuard: true }, "");
    barrier = true;
  }
}

/* true if it is fine to leave (nothing to lose, or the student chose to leave) */
export async function canLeave() {
  if (!isActive()) return true;
  const answer = await confirmDialog(guard.dialog);
  if (answer && guard.onLeave) guard.onLeave();
  return answer;
}

async function onClick(event) {
  if (!isActive() || event.defaultPrevented) return;

  const link = event.target && event.target.closest ? event.target.closest("a[href]") : null;
  if (!link || link.hasAttribute("data-soon") || link.hasAttribute("download")) return;
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  if (link.target && link.target !== "_self") return;

  const url = new URL(link.href, window.location.href);
  if (url.origin !== window.location.origin) return; // other websites: the browser's own message covers it
  if (url.pathname === window.location.pathname && url.search === window.location.search) return; // same page

  event.preventDefault();
  if (await canLeave()) window.location.replace(url.href);
}

async function onPopState() {
  if (!barrier) return;
  barrier = false; // the extra step was just used up by the Back press

  if (!isActive()) {
    window.history.back(); // nothing to protect any more, carry on leaving
    return;
  }

  const answer = await confirmDialog(guard.dialog);
  if (answer) {
    if (guard.onLeave) guard.onLeave();
    window.history.back();
  } else {
    window.history.pushState({ leaveGuard: true }, ""); // put the extra step back
    barrier = true;
  }
}

/* Called once by the app shell */
export function installLeaveGuard() {
  if (installed) return;
  installed = true;
  document.addEventListener("click", onClick);
  window.addEventListener("popstate", onPopState);
}