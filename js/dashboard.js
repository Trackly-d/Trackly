/* ==========================================================
   TEMPORARY dashboard test script
   Only proves that login works. Delete it when the real dashboard is built.
   Every private page should start with requireAuth, like below.
   ========================================================== */

import { requireAuth, logOut, LOGIN_URL } from "./auth.js";

const page = document.getElementById("page");
const who = document.getElementById("who");

requireAuth((user) => {
  who.textContent = user.displayName || user.email;
  page.hidden = false;
});

document.getElementById("signout").addEventListener("click", async () => {
  await logOut();
  window.location.replace(LOGIN_URL);
});