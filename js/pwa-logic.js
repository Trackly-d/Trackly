/* ==========================================================
   TRACKLY install logic (pure, tested in Node)
   Decides what the install button should do on this device.
     "prompt"     Chrome, Edge and similar fired the install event: the button opens the browser's real install box
     "ios"        iPhone or iPad in Safari: the button opens the "Add to Home Screen" guide
     "installed"  Trackly is already running as an installed app: no button
     "none"       a browser that cannot install (for example Firefox on a computer): no button
   ========================================================== */

export function isIosDevice({ ua = "", platform = "", maxTouchPoints = 0 } = {}) {
  // iPadOS pretends to be a Mac, so a Mac with a touch screen is an iPad
  return /iPad|iPhone|iPod/.test(ua) || (platform === "MacIntel" && maxTouchPoints > 1);
}

export function installMode({ ua = "", platform = "", maxTouchPoints = 0, standalone = false, hasPrompt = false } = {}) {
  if (standalone) return "installed";
  if (hasPrompt) return "prompt";
  if (isIosDevice({ ua, platform, maxTouchPoints })) return "ios";
  return "none";
}
