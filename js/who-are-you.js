/* ==========================================================
   TRACKLY "Who are you?"
   Remembers the student's choice (sessionStorage, gone when the tab closes) and sends them on:
     Higher Institution  ->  sign up
     Secondary School    ->  parental consent first
   Opened with ?finish=1, it is the last step for a brand new Google account that has no level yet (see js/finish-signup.js).
   ========================================================== */

import { writeFlow } from "./consent-logic.js";

const finishing = new URLSearchParams(window.location.search).get("finish") === "1";
const choices = document.querySelector(".cs-choices");

function say(text) {
  let note = document.getElementById("wy-note");
  if (!note) {
    note = document.createElement("p");
    note.id = "wy-note";
    note.className = "cs-lead-light";
    note.setAttribute("role", "alert");
    note.style.marginTop = "16px";
    choices.after(note);
  }
  note.textContent = text;
}

async function finishHigher() {
  try {
    const finish = await import("./finish-signup.js");
    const user = await finish.currentStudent();
    if (!user) { window.location.replace("login.html#signin"); return; }
    await finish.completeLevel(user, { level: "higher" });
  } catch (err) {
    console.error("Could not finish sign up:", err);
    say("We could not save your choice. Check your connection and try again.");
  }
}

for (const card of document.querySelectorAll("[data-level]")) {
  card.addEventListener("click", (event) => {
    event.preventDefault();
    const level = card.dataset.level;
    writeFlow(window.sessionStorage, { level, requestId: "", parentMask: "", finishing });
    if (level === "secondary") window.location.assign("parental-consent.html");
    else if (finishing) finishHigher();
    else window.location.assign("signup.html");
  });
}

if (finishing) {
  // A new Google account must answer before using Trackly, so there is no plain Back. They can cancel and remove the account.
  document.getElementById("wy-back").hidden = true;
  const cancel = document.createElement("a");
  cancel.href = "index.html";
  cancel.className = "cs-link";
  cancel.style.color = "#FFFFFF";
  cancel.textContent = "Cancel and delete this new account";
  cancel.addEventListener("click", async (event) => {
    event.preventDefault();
    const finish = await import("./finish-signup.js");
    await finish.abandonNewAccount(await finish.currentStudent());
  });
  choices.after(cancel);
  import("./finish-signup.js").then(async (finish) => {
    if (!(await finish.currentStudent())) window.location.replace("login.html#signin");
  }).catch((err) => console.error("Could not check the sign in:", err));
}
