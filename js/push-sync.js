/* ==========================================================
   TRACKLY push hooks for the pages
   Small helpers the pages call right after they save something. They NEVER throw and never hold up the student for
   long (3 seconds at most), because a push is a bonus, never a reason to lose or delay a save.
     notifyPush(user, kind, { id, title, courseName })   tell the student's OTHER devices
     watchPush(user, items)                              keep the due soon and overdue alerts up to date
   Both do nothing at all unless this student has turned push on (users/{uid}.pushEnabled), so students who never use push
   cost nothing. The answer is remembered for 10 minutes.
   ========================================================== */

import { fetchUserRecord } from "./users.js";
import { cached } from "./cache.js";
import { createPushClient } from "./push-client.js";
import { PUSH_CONFIGURED } from "./push-config.js";
import { watchItem } from "./push-logic.js";
import { toDate } from "./assignments.js";

const CAP_MS = 3000;
const toMs = (value) => { const d = toDate(value); return d ? d.getTime() : 0; };

export const PUSH_ENABLED_KEY = "push:enabled";

async function pushIsOn(uid) {
  if (!PUSH_CONFIGURED) return false;
  return cached(uid, PUSH_ENABLED_KEY, 10 * 60 * 1000, async () => {
    const record = await fetchUserRecord(uid);
    return Boolean(record && record.pushEnabled);
  });
}

function withCap(promise) {
  return Promise.race([promise, new Promise((resolve) => setTimeout(resolve, CAP_MS))]);
}

/* This device's own push address, so the Worker can leave this device out (it did the thing itself) */
async function thisEndpoint() {
  try {
    if (!("serviceWorker" in navigator)) return "";
    const registration = await navigator.serviceWorker.getRegistration();
    const sub = registration && (await registration.pushManager.getSubscription());
    return sub ? sub.endpoint : "";
  } catch (err) {
    return "";
  }
}

export async function notifyPush(user, kind, { id, title, courseName = "" }) {
  try {
    if (!(await pushIsOn(user.uid))) return;
    const client = createPushClient({ getToken: () => user.getIdToken() });
    await withCap(client.event({ kind, id, title, courseName, endpoint: await thisEndpoint() }));
  } catch (err) {
    console.error("Push problem:", err && err.code ? err.code : err);
  }
}

/* assignments: [{ record, courseName }]. A record that is no longer open is removed from the alerts. */
export async function watchPush(user, assignments) {
  try {
    if (!(await pushIsOn(user.uid))) return;
    const items = assignments.map(({ record, courseName }) => watchItem(record, courseName, toMs)).filter(Boolean);
    if (!items.length) return;
    const client = createPushClient({ getToken: () => user.getIdToken() });
    await withCap(client.watch(items));
  } catch (err) {
    console.error("Push problem:", err && err.code ? err.code : err);
  }
}

/* The assignment is gone (deleted) */
export async function unwatchPush(user, assignmentId) {
  try {
    if (!(await pushIsOn(user.uid))) return;
    const client = createPushClient({ getToken: () => user.getIdToken() });
    await withCap(client.watch([{ assignmentId, status: "closed" }]));
  } catch (err) {
    console.error("Push problem:", err && err.code ? err.code : err);
  }
}
