import { installMode, isIosDevice } from "../js/pwa-logic.js";

let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(ok ? "PASS" : "FAIL", name, ok ? "" : "got " + JSON.stringify(got) + " want " + JSON.stringify(want));
};
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; SM-A546B) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36";
const WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36";

check("android with the browser's install box: use it", installMode({ ua: ANDROID, hasPrompt: true }), "prompt");
check("android before the browser offers it: no button yet", installMode({ ua: ANDROID }), "none");
check("a computer with the install box", installMode({ ua: WINDOWS, hasPrompt: true }), "prompt");
check("a computer without it (Firefox): no button", installMode({ ua: WINDOWS }), "none");
check("iPhone in Safari: show the guide", installMode({ ua: IPHONE, platform: "iPhone" }), "ios");
check("iPad that looks like a Mac", installMode({ ua: WINDOWS, platform: "MacIntel", maxTouchPoints: 5 }), "ios");
check("a real Mac is not an iPad", isIosDevice({ ua: "Macintosh", platform: "MacIntel", maxTouchPoints: 0 }), false);
check("already installed: no button, on any device", [installMode({ ua: IPHONE, standalone: true }), installMode({ ua: ANDROID, standalone: true, hasPrompt: true })], ["installed", "installed"]);

console.log(failed ? failed + " FAILED" : "ALL PASSED");
process.exit(failed ? 1 : 0);
