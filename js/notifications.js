/* ==========================================================
   TRACKLY Notifications page
   Alerts (due soon, overdue) and history (added, submitted), newest first, 20 at a time.

   Due soon and overdue are worked out when the page opens, because nothing runs while Trackly is closed.
   Each carries the time it should have happened. Added and submitted were saved the moment they happened.
   Clicking a row opens its assignment and marks it read. "Mark all as read" marks everything.
   Reads: see js/notifications-data.js. Nothing important is kept in the browser.

   Design views (no data is read):  notifications.html?state=loading | ?state=error
   ========================================================== */

import { startApp, setBellDot, showToast } from "./shell.js";
import { fetchNotificationInputs, saveReadState, pruneActivity } from "./notifications-data.js";
import { fetchCourses } from "./courses-data.js";
import { invalidateCache } from "./cache.js";
import { el } from "./ui.js";
import {
  buildNotificationItems, filterItems, pageSlice, markRead, markAllRead, hasUnread, emptyMessage, timeAgo,
  PAGE_SIZE, WINDOW_DAYS
} from "./notifications-logic.js";

const STATE = new URLSearchParams(window.location.search).get("state");
const $ = (id) => document.getElementById(id);
const views = { loading: $("nt-loading"), error: $("nt-error"), page: $("nt-page") };
const ICON = { reminder: "bell", overdue: "alert", added: "calplus", submitted: "check", started: "play", edited: "edit", course_added: "book", course_edited: "book" };
const isCourse = (item) => item.type === "course_added" || item.type === "course_edited";

let uid = "";
let input = null;
let courseNames = new Map();
let read = { allBefore: 0, keys: {} };
let items = [];
let filter = "all";
let visible = PAGE_SIZE;

function show(name) {
  Object.keys(views).forEach((key) => { views[key].hidden = key !== name; });
}

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))]);
}

/* ---------- Drawing ---------- */
function icon(name) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("class", "icon");
  const use = document.createElementNS(ns, "use");
  use.setAttribute("href", "#i-" + name);
  svg.append(use);
  return svg;
}

function row(item) {
  const li = el("li");
  const link = el("a", "nt-item nt-" + (isCourse(item) ? "coursenew" : item.type) + (item.unread ? " is-unread" : ""));
  link.href = isCourse(item) ? "course.html?id=" + encodeURIComponent(item.courseId) : "assignment.html?id=" + encodeURIComponent(item.assignmentId);
  link.dataset.key = item.key;

  const badge = el("span", "nt-icon");
  badge.append(icon(ICON[item.type]));

  const body = el("span", "nt-body");
  body.append(el("span", "nt-title", item.title));
  if (item.courseName) body.append(el("span", "nt-course", "Course: " + item.courseName));

  const meta = el("span", "nt-meta");
  const time = el("time", "", timeAgo(item.time, new Date()));
  time.dateTime = new Date(item.time).toISOString();
  meta.append(time);
  if (item.unread) {
    const dot = el("span", "nt-dot");
    dot.setAttribute("role", "img");
    dot.setAttribute("aria-label", "Unread");
    meta.append(dot);
  }

  link.append(badge, body, meta);
  li.append(link);
  return li;
}

function compute() {
  items = buildNotificationItems({
    settings: { ...input.settings, read },
    assignments: input.assignments,
    activity: input.activity,
    courseNames,
    now: new Date()
  });
}

function render() {
  const list = filterItems(items, filter);
  const { shown, hasMore, remaining } = pageSlice(list, visible);
  const unreadCount = items.filter((i) => i.unread).length;

  document.querySelectorAll(".nt-chip").forEach((chip) => chip.setAttribute("aria-pressed", String(chip.dataset.filter === filter)));
  $("nt-markall").disabled = unreadCount === 0;

  $("nt-list").replaceChildren(...shown.map(row));
  $("nt-list").hidden = shown.length === 0;
  $("nt-empty").hidden = shown.length > 0;
  if (!shown.length) {
    const words = emptyMessage(filter);
    $("nt-empty-title").textContent = words.title;
    $("nt-empty-text").textContent = words.text;
  }

  $("nt-more").hidden = !hasMore;
  if (hasMore) $("nt-more").textContent = "Show more (" + remaining + " left)";

  $("nt-status").textContent = list.length + (list.length === 1 ? " notification" : " notifications") + (unreadCount ? ", " + unreadCount + " unread" : "");
  setBellDot(hasUnread(items));
}

/* ---------- Saving what was read ---------- */
async function saveRead() {
  try {
    await withTimeout(saveReadState(uid, read), 5000);
  } catch (err) {
    console.error("Could not save what was read:", err);
  }
  invalidateCache(uid); // so the bell on the next page is right
}

async function onRowClick(event) {
  const link = event.target.closest(".nt-item");
  if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.button) return;
  event.preventDefault();
  const item = items.find((i) => i.key === link.dataset.key);
  if (item && item.unread) {
    read = markRead(read, item, Date.now());
    await withTimeout(saveRead(), 3000).catch(() => {}); // never keep the student waiting
  }
  window.location.href = link.href;
}

async function onMarkAll() {
  read = markAllRead(Date.now());
  compute();
  render();
  await saveRead();
  showToast("All marked as read");
}

/* ---------- Loading ---------- */
async function load() {
  show("loading");
  try {
    input = await fetchNotificationInputs(uid);
    const courses = await fetchCourses(uid).catch((err) => { console.error("Could not load the courses:", err); return []; });
    courseNames = new Map(courses.map((course) => [course.id, course.title]));
  } catch (err) {
    console.error("Could not load the notifications:", err);
    show("error");
    return;
  }
  read = input.settings.read;
  compute();
  render();
  show("page");
  pruneActivity(uid, Date.now() - WINDOW_DAYS * 24 * 3600 * 1000).catch(() => {}); // tidy up, never in the way
}

/* ---------- Start ---------- */
function init(user) {
  uid = user.uid;
  if (views[STATE] && STATE !== "page") { show(STATE); return; }

  $("nt-filters").addEventListener("click", (event) => {
    const chip = event.target.closest(".nt-chip");
    if (!chip) return;
    filter = chip.dataset.filter;
    visible = PAGE_SIZE;
    render();
  });
  $("nt-list").addEventListener("click", onRowClick);
  $("nt-markall").addEventListener("click", onMarkAll);
  $("nt-more").addEventListener("click", () => { visible += PAGE_SIZE; render(); });
  $("nt-retry").addEventListener("click", load);
  $("nt-back").addEventListener("click", () => {
    let sameSite = false;
    try { sameSite = Boolean(document.referrer) && new URL(document.referrer).origin === window.location.origin; } catch (err) { /* no referrer */ }
    if (sameSite && window.history.length > 1) window.history.back();
    else window.location.href = "dashboard.html";
  });

  load();
}

startApp("notifications", init);
