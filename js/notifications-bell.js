/* ==========================================================
   TRACKLY bell dot
   Works out whether anything is unread, so the bell in the top bar can show its dot on every page.
   It uses the same remembered answer as the Notifications page (one minute), so it costs few reads.
   setDot is handed in by the shell, so this file does not depend on it.
   ========================================================== */

import { fetchNotificationInputs } from "./notifications-data.js";
import { buildNotificationItems, hasUnread } from "./notifications-logic.js";

export async function refreshBell(uid, setDot) {
  const input = await fetchNotificationInputs(uid);
  const items = buildNotificationItems({ settings: input.settings, assignments: input.assignments, activity: input.activity, now: new Date() });
  setDot(hasUnread(items));
}