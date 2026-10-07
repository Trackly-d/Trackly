/* ==========================================================
   TRACKLY app shell
   Builds the sidebar and top bar that every signed in page shares,
   fills in the student's name, and handles the mobile menu and Sign out.

   Every private page does just this:
     import { startApp } from "./shell.js";
     startApp("dashboard");        // the id of the page, see NAV below
   ========================================================== */

import { requireAuth, logOut, LOGIN_URL } from "./auth.js";
import { installLeaveGuard, canLeave } from "./leave-guard.js";

// Pages with forms use these to warn about unsaved changes (see leave-guard.js)
export { setLeaveGuard, refreshLeaveGuard } from "./leave-guard.js";

/* Icons: Feather icon set (free, MIT licence) */
const ICONS = {
  grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
  clipboard: '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="15" y2="16"/>',
  book: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  bell: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
  menu: '<line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
  chevron: '<polyline points="9 18 15 12 9 6"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  arrow: '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>',
  checkCircle: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>'
};

export function icon(name) {
  return '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[name] + "</svg>";
}

/* The sidebar links. When you build a new page, add its id to BUILT_PAGES
   and its link starts working (until then it shows "Coming soon"). */
const NAV = [
  { id: "dashboard",   label: "Dashboard",   href: "dashboard.html",   icon: "grid" },
  { id: "assignments", label: "Assignments", href: "assignments.html", icon: "clipboard" },
  { id: "courses",     label: "Courses",     href: "courses.html",     icon: "book" },
  { id: "calendar",    label: "Calendar",    href: "calendar.html",    icon: "calendar" },
  { id: "profile",     label: "Profile",     href: "profile.html",     icon: "user" },
  { id: "settings",    label: "Settings",    href: "settings.html",    icon: "settings" }
];
const BUILT_PAGES = ["dashboard", "courses"];

function renderShell(activePage, options = {}) {
  const links = NAV.map((item) => {
    const active = item.id === activePage;
    const soon = BUILT_PAGES.includes(item.id) ? "" : " data-soon";
    return '<li><a class="nav-link' + (active ? " is-active" : "") + '" href="' + item.href + '"' +
      (active ? ' aria-current="page"' : "") + soon + ">" + icon(item.icon) + item.label + "</a></li>";
  }).join("");

  document.getElementById("sidebar").innerHTML =
    '<a class="sidebar-logo" href="dashboard.html" aria-label="Trackly home">' +
      '<img src="assets/images/trackly-logo.png" alt="Trackly" width="1774" height="887">' +
    "</a>" +
    '<nav class="sidebar-nav" aria-label="Main"><ul>' + links + "</ul></nav>" +
    '<div class="sidebar-footer">' +
      '<div class="user-card">' +
        '<span class="avatar" id="user-avatar" aria-hidden="true"></span>' +
        '<div class="user-text"><p class="user-name" id="user-name"></p><p class="user-role">Student</p></div>' +
      "</div>" +
      '<button class="signout-btn" type="button" id="signout">' + icon("logout") + "Sign out</button>" +
    "</div>";

  document.getElementById("topbar").innerHTML =
    '<button class="icon-btn menu-btn" type="button" id="menu-btn" aria-label="Open menu" aria-expanded="false">' + icon("menu") + "</button>" +
    '<span class="topbar-title">Academic Workspace</span>' +
    (options.searchBar
      ? '<label class="topbar-search" id="topbar-search" hidden>' + icon("search") +
        '<input type="search" id="global-search" placeholder="Search assignments, courses, deadlines..." aria-label="Search assignments, courses and deadlines" autocomplete="off"></label>'
      : "") +
    '<div class="topbar-actions">' +
      '<button class="icon-btn" type="button" id="search-icon-btn" aria-label="Search" data-soon>' + icon("search") + "</button>" +
      '<button class="icon-btn" type="button" aria-label="Notifications" data-soon>' + icon("bell") + "</button>" +
      '<button class="icon-btn avatar-btn" type="button" aria-label="Your account" data-soon>' + icon("user") + "</button>" +
    "</div>";
}

/* Shows the student's name and their initials, for example "Alex Rivers" and "AR" */
function fillUser(user) {
  const name = user.displayName || (user.email ? user.email.split("@")[0] : "Student");
  const initials = name.trim().split(/\s+/).slice(0, 2).map((word) => word.charAt(0).toUpperCase()).join("");
  document.getElementById("user-name").textContent = name;
  document.getElementById("user-avatar").textContent = initials || "S";
}

let toastTimer = null;
export function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 2200);
}

function wireShell() {
  const app = document.getElementById("app");
  const menuBtn = document.getElementById("menu-btn");
  const backdrop = document.getElementById("backdrop");

  function setMenu(open) {
    app.classList.toggle("is-menu-open", open);
    backdrop.hidden = !open;
    menuBtn.setAttribute("aria-expanded", String(open));
    menuBtn.setAttribute("aria-label", open ? "Close menu" : "Open menu");
  }

  menuBtn.addEventListener("click", () => setMenu(!app.classList.contains("is-menu-open")));
  backdrop.addEventListener("click", () => setMenu(false));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setMenu(false);
  });

  // Anything marked data-soon shows a small "Coming soon" message instead of a broken page
  document.addEventListener("click", (event) => {
    const target = event.target.closest("[data-soon]");
    if (!target) return;
    event.preventDefault();
    setMenu(false);
    showToast("Coming soon");
  });

  installLeaveGuard();

  document.getElementById("signout").addEventListener("click", async () => {
    if (!(await canLeave())) return; // unsaved changes: ask first
    await logOut();
    window.location.replace(LOGIN_URL);
  });
}

/* Call this once per private page.
   The optional second argument runs once, as soon as we know who the student is:
     startApp("courses", (user) => { ...load this page's data... });
   The optional third argument { searchBar: true } adds the wide search box (dashboard only). */
export function startApp(activePage, onReady, options = {}) {
  renderShell(activePage, options);
  if (options.searchBar) document.getElementById("topbar").classList.add("has-search");
  wireShell();
  let started = false;
  requireAuth((user) => {
    fillUser(user);
    document.getElementById("app").hidden = false;
    if (onReady && !started) {
      started = true;
      onReady(user);
    }
  });
}