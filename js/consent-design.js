/* ==========================================================
   TRACKLY consent screens, DESIGN ONLY (no logic, reads no data)
   Lets you look at every state of the card. The real scripts replace this in the JavaScript step.

   parental-consent.html?state=
     form      the empty form (starting view)
     off       the same, with the button looking switched off (box not ticked yet)
     invalid   the email and the tick box showing their errors
     sending   the button shows "Sending..."
     error     a banner: the email could not be sent
     sent      "Check your parent's email" (waiting for approval)
     approved  the parent approved: the student can continue to sign up
     declined  the parent declined
     expired   the link ran out

   parent-approval.html?state=
     ready     what the parent sees when they open the link (starting view)
     approving the Approve button shows "Approving..."
     approved  thank you, the student can now create the account
     declined  no account will be created
     expired   the link ran out or was already used
   ========================================================== */

const card = document.querySelector(".cs-card[data-states]");
if (card) {
  const allowed = card.dataset.states.split(" ");
  const asked = new URLSearchParams(window.location.search).get("state");
  const state = allowed.includes(asked) ? asked : allowed[0];
  const FORM_LIKE = ["form", "off", "invalid", "sending", "error"];
  const view = FORM_LIKE.includes(state) ? "form" : state === "approving" ? "ready" : state;
  card.dataset.state = state;
  card.dataset.view = view;
  const label = document.getElementById("cs-state");
  if (label) label.textContent = state;
}
