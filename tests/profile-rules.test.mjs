import { validateName, initialsOf, googlePhotoOf, photoToShow, passwordMode, validatePasswordForm, passwordError, memberSinceText, validatePhotoFile, calendarReturn, reconcileCalendar } from "../js/profile-rules.js";

let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(ok ? "PASS" : "FAIL", name, ok ? "" : "got " + JSON.stringify(got) + " want " + JSON.stringify(want));
};

check("name trimmed and single spaced", validateName("  Alex   Rivers ").name, "Alex Rivers");
check("name too short", validateName(" a ").ok, false);
check("name empty", validateName("").error, "Enter your full name.");
check("name 60 is fine", validateName("x".repeat(60)).ok, true);
check("name 61 refused", validateName("x".repeat(61)).ok, false);
check("null name refused", validateName(null).ok, false);

check("initials of two words", initialsOf("Alex Rivers", "a@b.com"), "AR");
check("initials of three words use two", initialsOf("Mary Jane Watson"), "MJ");
check("initials from email when no name", initialsOf("", "zeke@school.edu"), "Z");
check("initials fallback", initialsOf("", ""), "S");

const google = [{ providerId: "google.com", photoURL: "https://g/photo.jpg" }];
const both = [{ providerId: "password" }, { providerId: "google.com", photoURL: "https://g/photo.jpg" }];
check("google photo found", googlePhotoOf(google), "https://g/photo.jpg");
check("no google photo", googlePhotoOf([{ providerId: "password" }]), "");
check("own photo wins", photoToShow({ custom: "https://c/me.jpg", google: "https://g/p.jpg" }), "https://c/me.jpg");
check("google photo next", photoToShow({ custom: "", google: "https://g/p.jpg" }), "https://g/p.jpg");
check("nothing means initials", photoToShow({ custom: "", google: "" }), "");

check("google only account sets a password", passwordMode(google), "set");
check("password account changes it", passwordMode([{ providerId: "password" }]), "change");
check("both providers change it", passwordMode(both), "change");
check("no providers sets", passwordMode([]), "set");

check("change needs the current password", validatePasswordForm({ current: "", next: "longenough1", confirm: "longenough1" }, "change").field, "current");
check("set does not need the current password", validatePasswordForm({ next: "longenough1", confirm: "longenough1" }, "set").ok, true);
check("new password too short", validatePasswordForm({ current: "oldpassword", next: "short", confirm: "short" }, "change").field, "next");
check("exactly 8 is fine", validatePasswordForm({ current: "oldpassword", next: "12345678", confirm: "12345678" }, "change").ok, true);
check("same as current refused", validatePasswordForm({ current: "oldpassword", next: "oldpassword", confirm: "oldpassword" }, "change").field, "next");
check("confirm must match", validatePasswordForm({ current: "oldpassword", next: "newpassword1", confirm: "newpassword2" }, "change").field, "confirm");

check("wrong password message", passwordError("auth/invalid-credential"), "Your current password is not right.");
check("recent login message", passwordError("auth/requires-recent-login").startsWith("For your safety"), true);
check("unknown code is empty", passwordError("auth/something-else"), "");

check("member since", memberSinceText(new Date(2026, 9, 2)), "Member since Oct 2026");
check("member since missing", memberSinceText(null), "");
check("jpeg accepted", validatePhotoFile({ type: "image/jpeg", size: 1000 }), "");
check("gif refused", validatePhotoFile({ type: "image/gif", size: 1000 }), "Choose a JPG, PNG or WebP photo.");
check("11 MB refused", validatePhotoFile({ type: "image/png", size: 11 * 1024 * 1024 }), "That photo is too large. Choose one under 10 MB.");
check("no file refused", validatePhotoFile(null), "Choose a JPG, PNG or WebP photo.");

check("return: connected", calendarReturn("connected"), { kind: "ok", message: "Google Calendar connected" });
check("return: denied is a problem", calendarReturn("denied").kind, "problem");
check("return: error is a problem", calendarReturn("error").kind, "problem");
check("return: anything else is nothing", [calendarReturn("hacked"), calendarReturn(null), calendarReturn("")], [null, null, null]);
check("worker connected, hint missing: set the hint", reconcileCalendar(false, "connected"), { state: "on", flag: "set" });
check("worker connected, hint present: keep", reconcileCalendar(true, "connected"), { state: "on", flag: "keep" });
check("worker disconnected, hint present: clear the hint", reconcileCalendar(true, "disconnected"), { state: "off", flag: "clear" });
check("worker disconnected, no hint: nothing to do", reconcileCalendar(false, "disconnected"), { state: "off", flag: "keep" });
check("worker says reconnect: show reconnect, keep the hint", reconcileCalendar(true, "reconnect"), { state: "reconnect", flag: "keep" });
check("unknown answer: trust the hint", [reconcileCalendar(true, "???").state, reconcileCalendar(false, undefined).state], ["on", "off"]);

console.log(failed ? failed + " FAILED" : "ALL PASSED");
process.exit(failed ? 1 : 0);
