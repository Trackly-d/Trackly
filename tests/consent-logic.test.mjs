import { normalizeParentEmail, maskEmail, readFlow, writeFlow, clearFlow, signupGate, viewForStatus, levelFields, canSendRequest, formProblems, FLOW_KEY, EXPIRY_DAYS } from "../js/consent-logic.js";

let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(ok ? "PASS" : "FAIL", name, ok ? "" : "got " + JSON.stringify(got) + " want " + JSON.stringify(want));
};
const memory = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };

// ---------- the parent's email
check("a normal email is accepted and tidied", normalizeParentEmail("  Mum@Example.COM "), "mum@example.com");
for (const bad of ["", "mum", "mum@", "@example.com", "mum@example", "mum@@example.com", "a b@example.com", "a@b.com,c@d.com", "a@b.com;c@d.com", "<a@b.com>", "a@b.com\nBcc: x@y.com", ".a@b.com", "a..b@b.com", "a@-b.com", "a@b..com", "x".repeat(70) + "@example.com", "a@" + "b".repeat(250) + ".com"]) {
  check("refused: " + JSON.stringify(bad).slice(0, 40), normalizeParentEmail(bad), "");
}
check("a plus address is fine", normalizeParentEmail("mum+trackly@example.com"), "mum+trackly@example.com");
check("a .com.ng address is fine", normalizeParentEmail("ada@school.edu.ng"), "ada@school.edu.ng");
check("only the first letter and the domain are shown", [maskEmail("parent@gmail.com"), maskEmail("a@b.com"), maskEmail("nonsense")], ["p***@gmail.com", "a***@b.com", ""]);

// ---------- what the journey remembers
const s = memory();
check("nothing remembered at the start", readFlow(s), null);
writeFlow(s, { level: "secondary", requestId: "A".repeat(22), parentMask: "p***@gmail.com", finishing: false });
check("it comes back as saved", readFlow(s), { level: "secondary", requestId: "A".repeat(22), parentMask: "p***@gmail.com", finishing: false });
writeFlow(s, { level: "higher" });
check("missing parts get safe defaults", readFlow(s), { level: "higher", requestId: "", parentMask: "", finishing: false });
s.setItem(FLOW_KEY, JSON.stringify({ level: "hacker", requestId: "x" }));
check("an unknown level is ignored", readFlow(s), null);
s.setItem(FLOW_KEY, JSON.stringify({ level: "secondary", requestId: "../../etc" }));
check("an odd request id is dropped", readFlow(s).requestId, "");
s.setItem(FLOW_KEY, "{broken");
check("broken data is ignored", readFlow(s), null);
writeFlow(s, { level: "higher" }); clearFlow(s);
check("clearing forgets everything", readFlow(s), null);
check("a blocked storage never crashes", [readFlow({ getItem() { throw new Error("blocked"); } }), writeFlow({ setItem() { throw new Error("blocked"); } }, {}), clearFlow({ removeItem() { throw new Error("blocked"); } })], [null, false, undefined]);

// ---------- where sign up sends a student
check("no choice yet: back to Who are you?", signupGate(null), "who-are-you.html");
check("higher institution may sign up", signupGate({ level: "higher", requestId: "" }), "ok");
check("secondary with no parent request: ask a parent first", signupGate({ level: "secondary", requestId: "" }), "parental-consent.html");
check("secondary with a request: check it is approved", signupGate({ level: "secondary", requestId: "A".repeat(22) }), "check");

check("each status has a screen", ["pending", "approved", "declined", "expired", "unknown", "weird"].map(viewForStatus), ["sent", "approved", "declined", "expired", "expired", "expired"]);

// ---------- what is saved on the record
const when = new Date("2026-11-01T10:00:00Z");
check("a higher institution student", levelFields({ level: "higher" }), { studentLevel: "higher" });
check("a secondary school student carries the consent record", levelFields({ level: "secondary", approvedAt: when, requestId: "REQ" }), { studentLevel: "secondary", parentalConsent: true, parentalConsentAt: when, consentRequestId: "REQ" });
check("a higher institution student never gets a consent flag", "parentalConsent" in levelFields({ level: "higher", approvedAt: when }), false);

// ---------- the form
check("the button needs a real email, the tick and no other request running", [canSendRequest({ email: "a@b.co", aware: true, busy: false }), canSendRequest({ email: "x", aware: true, busy: false }), canSendRequest({ email: "a@b.co", aware: false, busy: false }), canSendRequest({ email: "a@b.co", aware: true, busy: true })], [true, false, false, false]);
check("the form says what is wrong", [formProblems({ email: "nope", aware: false }), formProblems({ email: "a@b.co", aware: true })], [{ email: "Enter a valid email address.", aware: "Please tick the box to continue." }, { email: "", aware: "" }]);
check("links last 7 days", EXPIRY_DAYS, 7);

console.log(failed ? failed + " FAILED" : "ALL PASSED");
process.exit(failed ? 1 : 0);
