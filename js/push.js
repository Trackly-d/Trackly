/* ==========================================================
   TRACKLY push on this device
   Used by the Settings page (the Push notifications card), the Log Out button and Delete account.

   What the switch does:
     ON   asks the browser for permission (it must be a tap, iPhone insists), subscribes this device, tells the push Worker,
          saves users/{uid}.pushEnabled and .pushTypes, copies the alert choices to the Worker, and sends it the open assignments.
     OFF  removes this device from the Worker and from the browser. When it was the student's last device, the Worker forgets
          their alerts too, and pushEnabled goes back to false.
   Per kind switches are saved on the student's record (users/{uid}.pushTypes) and copied to the Worker.

   The card shows one state at a time (its data-push): off, asking, on, blocked, unsupported, ios, error.
   ========================================================== */

import * as fs from "./firebase-config.js";
import { createPushClient, pushErrorMessage } from "./push-client.js";
import { PUSH_CONFIGURED, VAPID_PUBLIC_KEY } from "./push-config.js";
import { TYPE_KEYS, normalizeTypes, switchId, pushSupport, urlBase64ToBytes, watchItem } from "./push-logic.js";
import { isIosDevice } from "./pwa-logic.js";
import { invalidateCache } from "./cache.js";
import { toDate } from "./assignments.js";
import { plain } from "./plain.js";

const $ = (id) => document.getElementById(id);
const toMs = (value) => { const d = toDate(value); return d ? d.getTime() : 0; };
const standalone = () => (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || window.navigator.standalone === true;

function supportNow() {
  const hasNotification = "Notification" in window;
  return pushSupport({
    isIos: isIosDevice({ ua: navigator.userAgent, platform: navigator.platform, maxTouchPoints: navigator.maxTouchPoints }),
    standalone: standalone(),
    hasServiceWorker: "serviceWorker" in navigator,
    hasPushManager: "PushManager" in window,
    hasNotification,
    permission: hasNotification ? Notification.permission : "default"
  });
}

async function registration() {
  if (!(await navigator.serviceWorker.getRegistration())) await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  return navigator.serviceWorker.ready;
}

async function currentSubscription() {
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

async function subscribeThisDevice() {
  const reg = await registration();
  let sub = await reg.pushManager.getSubscription();
  if (sub) return sub;
  const options = { userVisibleOnly: true, applicationServerKey: urlBase64ToBytes(VAPID_PUBLIC_KEY) };
  try {
    return await reg.pushManager.subscribe(options);
  } catch (err) {
    if (err && err.name === "InvalidStateError") { // an old subscription made with a different key
      const old = await reg.pushManager.getSubscription();
      if (old) await old.unsubscribe();
      return reg.pushManager.subscribe(options);
    }
    throw err;
  }
}

/* ---------- Log Out: this device stops receiving this student's pushes ---------- */
export async function detachThisDevice(user) {
  try {
    if (!("serviceWorker" in navigator)) return;
    const sub = await currentSubscription();
    if (!sub) return;
    const client = createPushClient({ getToken: () => user.getIdToken() });
    let devices = 1;
    try { devices = (await client.unsubscribe(sub.endpoint)).devices; } catch (err) { /* the push service will tell the Worker later */ }
    await sub.unsubscribe();
    if (devices === 0) {
      await client.deleteAll().catch(() => {});
      await fs.setDoc(fs.doc(fs.db, "users", user.uid), { pushEnabled: false }, { merge: true }).catch(() => {});
      invalidateCache(user.uid);
    }
  } catch (err) {
    console.error("Could not detach this device:", err);
  }
}

/* ---------- Delete account: the Worker forgets everything about the student ---------- */
export async function removePushData(user, record) {
  if (!PUSH_CONFIGURED || !(record && record.pushEnabled)) return;
  await createPushClient({ getToken: () => user.getIdToken() }).deleteAll();
  try { const sub = await currentSubscription(); if (sub) await sub.unsubscribe(); } catch (err) { /* the account is going away anyway */ }
}

/* ---------- The Settings card ----------
   getAlerts() returns { alertsEnabled, alertHours } as saved on Settings. say(text) shows a short message. */
export function createPushController({ user, getAlerts, say }) {
  const uid = user.uid;
  const client = createPushClient({ getToken: () => user.getIdToken() });
  let types = normalizeTypes({});
  let state = "off";
  let busy = false;
  const card = () => $("push");
  const master = () => $("st-push");

  function setState(next, message) {
    state = next;
    card().dataset.push = next;
    if (message) card().querySelector(".st-note-error").textContent = message;
    master().checked = next === "on" || next === "asking";
    master().disabled = ["asking", "blocked", "unsupported", "ios"].includes(next);
  }

  function drawTypes() {
    TYPE_KEYS.forEach((key) => { const box = $(switchId(key)); if (box) box.checked = types[key]; });
  }

  const saveUser = (fields) => fs.setDoc(fs.doc(fs.db, "users", uid), fields, { merge: true });

  async function syncPrefs() {
    const alerts = getAlerts();
    await client.prefs({ alertsEnabled: alerts.alertsEnabled, alertHours: alerts.alertHours, types });
  }

  /* Tells the Worker about every open assignment, so due soon and overdue pushes work for them from now on */
  async function backfill() {
    const [snap, courses] = await Promise.all([
      fs.getDocs(fs.query(fs.collection(fs.db, "users", uid, "assignments"), fs.where("dueAt", ">", new Date()), fs.orderBy("dueAt"), fs.limit(200))),
      fs.getDocs(fs.collection(fs.db, "users", uid, "courses"))
    ]);
    const names = new Map(courses.docs.map((d) => [d.id, d.data().title || ""]));
    const items = snap.docs.map(plain).map((a) => watchItem(a, names.get(a.courseId) || "", toMs)).filter(Boolean);
    if (items.length) await client.watch(items);
  }

  async function turnOn() {
    setState("asking");
    try {
      const permission = await Notification.requestPermission(); // this runs straight from the tap
      if (permission === "denied") return setState("blocked");
      if (permission !== "granted") return setState("off");
      if (!PUSH_CONFIGURED) throw Object.assign(new Error("not_configured"), { code: "not_configured" });
      const sub = await subscribeThisDevice();
      await client.subscribe(sub.toJSON());
      await saveUser({ pushEnabled: true, pushTypes: types });
      invalidateCache(uid);
      await syncPrefs();
      try { await backfill(); } catch (err) { console.error("Could not send your assignments to the alert service:", err); }
      setState("on");
    } catch (err) {
      console.error("Could not switch push on:", err);
      setState("error", pushErrorMessage(err && err.code));
    }
  }

  async function turnOff() {
    master().disabled = true;
    try {
      const sub = await currentSubscription();
      let devices = 1;
      if (sub) {
        try { devices = (await client.unsubscribe(sub.endpoint)).devices; } catch (err) { console.error("The alert service could not be told:", err); }
        await sub.unsubscribe();
      }
      if (devices === 0) {
        await client.deleteAll().catch(() => {});
        await saveUser({ pushEnabled: false });
        invalidateCache(uid);
      }
    } catch (err) {
      console.error("Could not switch push off:", err);
    }
    setState("off");
  }

  async function onMaster() {
    if (busy) return;
    busy = true;
    try { await (master().checked ? turnOn() : turnOff()); } finally { busy = false; }
  }

  async function onType(event) {
    const box = event.target;
    const key = TYPE_KEYS.find((k) => switchId(k) === box.id);
    if (!key || busy) return;
    const before = types[key];
    types = { ...types, [key]: box.checked };
    busy = true;
    try {
      await saveUser({ pushTypes: types });
      await syncPrefs();
    } catch (err) {
      console.error("Could not save the push choice:", err);
      types = { ...types, [key]: before };
      box.checked = before;
      if (say) say("Could not save. Check your connection.");
    }
    busy = false;
  }

  return {
    async init() {
      if (!card()) return;
      let record = {};
      try { const snap = await fs.getDoc(fs.doc(fs.db, "users", uid)); record = snap.exists() ? snap.data() : {}; } catch (err) { console.error("Could not read the push choices:", err); }
      types = normalizeTypes(record.pushTypes);
      drawTypes();

      const support = supportNow();
      if (support !== "ok") return setState(support);
      let sub = null;
      try { sub = Notification.permission === "granted" ? await currentSubscription() : null; } catch (err) { sub = null; }
      setState(sub ? "on" : "off");
      if (sub && PUSH_CONFIGURED) { // quietly keep the Worker's copy fresh (a push address can change)
        client.subscribe(sub.toJSON()).then(syncPrefs).catch((err) => console.error("Could not refresh push:", err));
      }
      master().addEventListener("change", onMaster);
      TYPE_KEYS.forEach((key) => { const box = $(switchId(key)); if (box) box.addEventListener("change", onType); });
    },
    /* Settings calls this after the alert times or the alerts switch were saved */
    async alertsChanged() {
      if (state !== "on") return;
      try { await syncPrefs(); } catch (err) { console.error("Could not update the alert times for push:", err); }
    }
  };
}
