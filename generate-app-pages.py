"""
Writes settings.html and notifications.html (the signed in Settings and Notifications pages).

HOW TO USE (needs Python 3, no extra packages; run it from the project folder):
  python generate-app-pages.py            writes the pages
  python generate-app-pages.py --check    changes NOTHING; says whether the pages on disk match what this script would write

WHY THIS FILE EXISTS: these pages are written by a script, so their wording, icons and layout stay consistent.
To change a page, change THIS script and run it again. Do not hand-edit the generated pages, the next run would undo it.
Hosting would publish this file, so keep "*.py" in the ignore list of firebase.json.
tests/generators.test.mjs runs the --check mode when Python is available.
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CHECK = "--check" in sys.argv
_differences = []


def emit(name, content):
    """Writes a page, or (with --check) only compares it with what is on disk."""
    path = ROOT / name
    if CHECK:
        current = path.read_text(encoding="utf-8") if path.exists() else None
        if current != content:
            _differences.append(name)
        return
    path.write_text(content, encoding="utf-8")
    print("wrote", name, len(content.encode("utf-8")), "bytes")


def finish():
    if CHECK:
        if _differences:
            print("DIFFERENT from the script:", ", ".join(_differences))
            sys.exit(1)
        print("OK: every page matches the script")


ICONS = {
 "id": '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M15 9h3M15 13h3M6 17c.7-1.5 2-2 3-2s2.3.5 3 2"/>',
 "key": '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
 "out": '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
 "phone": '<rect x="7" y="2" width="10" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>',
 "clock": '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
 "bell": '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
 "help": '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
 "shield": '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
 "file": '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
 "trash": '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
 "chev": '<polyline points="9 18 15 12 9 6"/>',
 "x": '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
 "back": '<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>',
 "alert": '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
 "calplus": '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="12" y1="14" x2="12" y2="18"/><line x1="10" y1="16" x2="14" y2="16"/>',
 "check": '<polyline points="20 6 9 17 4 12"/>',
 "play": '<polygon points="5 3 19 12 5 21 5 3"/>',
 "edit": '<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>',
 "book": '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
}
def sprite(names):
    syms = "\n".join('      <symbol id="i-%s" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">%s</symbol>' % (n, ICONS[n]) for n in names)
    return '  <svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">\n    <defs>\n%s\n    </defs>\n  </svg>' % syms
def ic(n, cls="icon"): return '<svg class="%s"><use href="#i-%s"/></svg>' % (cls, n)

def page(title, css, sprite_html, content, script):
    return '''<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>%(title)s | Trackly</title>
  <!-- Signed in pages are private and kept out of Google -->
  <meta name="robots" content="noindex, nofollow">

  <!-- Inter font -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">

  <!-- Styles: base, components, the app frame, then this page -->
  <link rel="stylesheet" href="css/base.css">
  <link rel="stylesheet" href="css/components.css">
  <link rel="stylesheet" href="css/app.css">
  <link rel="stylesheet" href="css/%(css)s.css">
  <!-- App install and push (PWA) -->
  <link rel="manifest" href="/manifest.webmanifest">
  <meta name="theme-color" content="#0E5C4A">
  <link rel="apple-touch-icon" href="/assets/images/apple-touch-icon.png">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-title" content="Trackly">
</head>
<body>
%(sprite)s

  <!-- Hidden until Firebase confirms the student is signed in -->
  <div class="app-layout" id="app" hidden>
    <div class="app-backdrop" id="backdrop" hidden></div>

    <!-- Sidebar and top bar are built by js/shell.js -->
    <aside class="sidebar" id="sidebar"></aside>

    <div class="app-main">
      <header class="topbar" id="topbar"></header>

      <main class="app-content">
%(content)s
      </main>
    </div>
  </div>

  <div class="toast" id="toast" role="status" hidden></div>

  <script type="module" src="js/%(script)s.js"></script>
  <script type="module" src="/js/pwa.js"></script>
</body>
</html>
''' % dict(title=title, css=css, sprite=sprite_html, content=content, script=script)

# ============================ SETTINGS ============================
def row_link(href, icon, label, sub, sub_id="", extra=""):
    return '''            <a class="st-row" href="%s">
              <span class="st-icon">%s</span>
              <span class="st-text"><span class="st-label">%s</span><span class="st-sub"%s>%s</span></span>%s
              <span class="st-chevron">%s</span>
            </a>''' % (href, ic(icon), label, (' id="%s"' % sub_id) if sub_id else "", sub, extra, ic("chev"))

settings_content = '''        <div class="settings-page">

          <!-- LOADING (JavaScript step) -->
          <div class="st-loading" id="st-loading" aria-busy="true" aria-label="Loading your settings" hidden>
            <div class="st-sk st-sk-head"></div>
            <div class="st-sk st-sk-card"></div>
          </div>

          <!-- The page could not load (usually the network) -->
          <div class="load-error" id="st-error" role="alert" hidden>
            <p>We could not load your settings. Check your connection and try again.</p>
            <button class="btn btn-outline-link btn-retry" type="button" id="st-retry">Try again</button>
          </div>

          <!-- THE PAGE. Design views with sample data:
               settings.html?state=loading | error | delete | deletegoogle | deleting -->
          <div class="st-page" id="st-page" hidden>
            <header class="st-head">
              <h1>Settings</h1>
              <p>Manage your student profile.</p>
            </header>

            <div class="st-layout">
              <aside class="st-side">
                <nav class="st-nav" aria-label="Settings sections">
                  <a href="#account" class="is-active">Account</a>
                  <a href="#notifications">Notifications</a>
                  <a href="#about">About</a>
                </nav>
                <p class="st-version"><span>Trackly <span id="st-version">v1.0.0</span></span><span id="st-build">Oct 2026</span></p>
              </aside>

              <div class="st-main">

                <section class="st-card" id="account" aria-labelledby="st-account-title">
                  <div class="st-card-head"><h2 id="st-account-title">Account</h2></div>
%(profile)s
%(password)s
                  <button class="st-row" type="button" id="st-logout">
                    <span class="st-icon st-icon-red">%(out)s</span>
                    <span class="st-text"><span class="st-label st-red">Log Out</span></span>
                    <span class="st-tag">Current session</span>
                  </button>
                  <button class="st-row st-row-danger" type="button" id="st-delete">
                    <span class="st-icon st-icon-red">%(trash)s</span>
                    <span class="st-text"><span class="st-label st-red">Delete account</span><span class="st-sub">Permanently remove your account and all your data</span></span>
                    <span class="st-chevron">%(chev)s</span>
                  </button>
                </section>

                <!-- PUSH CARD. Its data-push (off, asking, on, blocked, unsupported, ios or error) is set by js/push.js -->
                <section class="st-card" id="push" aria-labelledby="st-push-title" data-push="off">
                  <div class="st-card-head"><h2 id="st-push-title">Push notifications</h2><span class="st-tag">This device</span></div>

                  <div class="st-row st-row-static">
                    <span class="st-icon">%(phone)s</span>
                    <span class="st-text"><span class="st-label">Push notifications</span><span class="st-sub">Get alerts on this device, even when Trackly is closed</span></span>
                    <label class="st-switch"><input type="checkbox" role="switch" id="st-push" aria-label="Push notifications"><span class="st-track"></span></label>
                  </div>

                  <!-- One message at a time, chosen by the card's data-push -->
                  <p class="st-note st-note-asking" role="status">Waiting for your answer. Choose Allow in the box your browser just showed.</p>
                  <p class="st-note st-note-blocked" role="alert">Notifications are blocked for Trackly in this browser. Allow them in your browser's site settings, then come back and switch this on.</p>
                  <p class="st-note st-note-unsupported">This browser cannot receive push notifications. Chrome, Edge, Firefox and Safari can.</p>
                  <p class="st-note st-note-ios">On iPhone and iPad, install Trackly first: tap Share, then Add to Home Screen, and open Trackly from its icon. It needs iOS 16.4 or newer.</p>
                  <p class="st-note st-note-error" role="alert">We could not switch push on. Check your connection and try again.</p>

                  <!-- Shown only while push is on -->
                  <div class="st-push-types" id="st-push-types">
                    <p class="st-sub st-push-intro">Things you do on this device are sent to your other devices, never to this one. Deadline alerts go to every device.</p>
                  <h3 class="st-group">Deadlines</h3>
                  <div class="st-row st-row-static st-type">
                    <span class="st-text"><span class="st-label">Due soon</span><span class="st-sub">Uses the times you choose in Due soon alerts below</span></span>
                    <label class="st-switch"><input type="checkbox" role="switch" id="st-push-due" aria-label="Due soon" checked><span class="st-track"></span></label>
                  </div>
                  <div class="st-row st-row-static st-type">
                    <span class="st-text"><span class="st-label">Overdue</span></span>
                    <label class="st-switch"><input type="checkbox" role="switch" id="st-push-overdue" aria-label="Overdue" checked><span class="st-track"></span></label>
                  </div>
                  <h3 class="st-group">Assignments</h3>
                  <div class="st-row st-row-static st-type">
                    <span class="st-text"><span class="st-label">Assignment added</span></span>
                    <label class="st-switch"><input type="checkbox" role="switch" id="st-push-added" aria-label="Assignment added" checked><span class="st-track"></span></label>
                  </div>
                  <div class="st-row st-row-static st-type">
                    <span class="st-text"><span class="st-label">Assignment started</span></span>
                    <label class="st-switch"><input type="checkbox" role="switch" id="st-push-started" aria-label="Assignment started"><span class="st-track"></span></label>
                  </div>
                  <div class="st-row st-row-static st-type">
                    <span class="st-text"><span class="st-label">Assignment submitted</span></span>
                    <label class="st-switch"><input type="checkbox" role="switch" id="st-push-submitted" aria-label="Assignment submitted" checked><span class="st-track"></span></label>
                  </div>
                  <div class="st-row st-row-static st-type">
                    <span class="st-text"><span class="st-label">Assignment edited</span></span>
                    <label class="st-switch"><input type="checkbox" role="switch" id="st-push-edited" aria-label="Assignment edited"><span class="st-track"></span></label>
                  </div>
                  <div class="st-row st-row-static st-type">
                    <span class="st-text"><span class="st-label">Assignment deleted</span></span>
                    <label class="st-switch"><input type="checkbox" role="switch" id="st-push-deleted" aria-label="Assignment deleted"><span class="st-track"></span></label>
                  </div>
                  <h3 class="st-group">Courses</h3>
                  <div class="st-row st-row-static st-type">
                    <span class="st-text"><span class="st-label">Course added</span></span>
                    <label class="st-switch"><input type="checkbox" role="switch" id="st-push-course-added" aria-label="Course added"><span class="st-track"></span></label>
                  </div>
                  <div class="st-row st-row-static st-type">
                    <span class="st-text"><span class="st-label">Course edited</span></span>
                    <label class="st-switch"><input type="checkbox" role="switch" id="st-push-course-edited" aria-label="Course edited"><span class="st-track"></span></label>
                  </div>
                  </div>
                </section>

                <section class="st-card" id="notifications" aria-labelledby="st-notif-title">
                  <div class="st-card-head"><h2 id="st-notif-title">Notifications</h2><span class="st-tag">Alerts in Trackly</span></div>

                  <div class="st-row st-row-static">
                    <span class="st-icon">%(bell)s</span>
                    <span class="st-text"><span class="st-label">Due soon alerts</span><span class="st-sub">See an alert in Trackly before an assignment is due</span></span>
                    <label class="st-switch"><input type="checkbox" role="switch" id="st-alerts" aria-label="Due soon alerts" checked><span class="st-track"></span></label>
                  </div>

                  <!-- Hidden while Due soon alerts is off. More than one can be chosen. -->
                  <div class="st-row st-row-static st-timing" id="st-timing">
                    <span class="st-icon">%(clock)s</span>
                    <span class="st-text">
                      <span class="st-label" id="st-timing-label">Alert timing</span>
                      <span class="st-sub">Choose when you want to be alerted before the due time</span>
                      <span class="st-chips" role="group" aria-labelledby="st-timing-label">
                        <label class="st-chip"><input type="checkbox" name="timing" value="3"><span>3 hours</span></label>
                        <label class="st-chip"><input type="checkbox" name="timing" value="24" checked><span>24 hours</span></label>
                        <label class="st-chip"><input type="checkbox" name="timing" value="48" checked><span>48 hours</span></label>
                      </span>
                      <span class="form-error" id="st-timing-error" role="alert" hidden></span>
                    </span>
                  </div>

%(seeall)s
                </section>

                <section class="st-card" id="about" aria-labelledby="st-about-title">
                  <div class="st-card-head"><h2 id="st-about-title">About</h2><span class="st-tag">Trackly</span></div>
%(help)s
%(privacy)s
%(terms)s
                </section>
              </div>
            </div>
          </div>

          <!-- DELETE ACCOUNT (a pop-up). Google only accounts see the Google note instead of the password box. -->
          <div class="st-modal" id="del-modal" hidden>
            <div class="st-modal-backdrop" id="del-backdrop"></div>
            <div class="st-dialog" role="dialog" aria-modal="true" aria-labelledby="del-title">
              <div class="st-dialog-head">
                <h2 id="del-title">Delete your account?</h2>
                <button class="st-close" type="button" id="del-close" aria-label="Close">%(x)s</button>
              </div>
              <p class="st-warn">This cannot be undone. Trackly will permanently remove:</p>
              <ul class="st-list">
                <li>Your profile and sign in</li>
                <li>Your courses and assignments</li>
                <li>Your reminders in Google Calendar, if you connected it</li>
                <li>Photos you uploaded</li>
              </ul>
              <form id="del-form" novalidate>
                <div class="st-field" id="del-password-field">
                  <label for="del-password">Your password</label>
                  <input class="st-input" type="password" id="del-password" autocomplete="current-password" placeholder="Enter your password">
                </div>
                <p class="st-note" id="del-google-note" hidden>For your safety, you will be asked to sign in with Google again.</p>
                <div class="st-field">
                  <label for="del-type">Type DELETE to confirm</label>
                  <input class="st-input" type="text" id="del-type" autocomplete="off" placeholder="DELETE">
                </div>
                <p class="form-error" id="del-error" role="alert" hidden></p>
                <p class="st-progress" id="del-progress" role="status" hidden>Deleting your account... Removing your reminders</p>
                <div class="st-dialog-actions">
                  <button class="st-btn st-btn-outline" type="button" id="del-cancel">Cancel</button>
                  <button class="st-btn st-btn-danger" type="submit" id="del-confirm">Delete my account</button>
                </div>
              </form>
            </div>
          </div>

        </div>''' % dict(
  profile=row_link("profile.html", "id", "Profile", "alex@school.edu", "st-email"),
  password=row_link("profile.html?open=password", "key", "Change Password", "Update the password you sign in with", "st-password-sub"),
  seeall=row_link("notifications.html", "bell", "See your notifications", "Open your list of alerts"),
  help=row_link("contact.html", "help", "Help &amp; Support", "Contact us"),
  privacy=row_link("privacy.html", "shield", "Privacy Policy", "How we handle your information"),
  terms=row_link("terms.html", "file", "Terms of Service", "The rules for using Trackly"),
  out=ic("out"), trash=ic("trash"), chev=ic("chev"), phone=ic("phone"), bell=ic("bell"), clock=ic("clock"), x=ic("x"))

emit('settings.html', page("Settings", "settings", sprite(["id","key","out","phone","clock","bell","help","shield","file","trash","chev","x"]), settings_content, "settings"))

# ============================ NOTIFICATIONS ============================
def nt_item(kind, icon, title, course, time, when, unread, sid, href="assignment.html"):
    return '''            <li>
              <a class="nt-item nt-%s%s" href="%s?id=%s">
                <span class="nt-icon">%s</span>
                <span class="nt-body"><span class="nt-title">%s</span><span class="nt-course">Course: %s</span></span>
                <span class="nt-meta"><time datetime="%s">%s</time>%s</span>
              </a>
            </li>''' % (kind, " is-unread" if unread else "", href, sid, ic(icon), title, course, when, time, '<span class="nt-dot" role="img" aria-label="Unread"></span>' if unread else "")

items = "\n".join([
  nt_item("edited", "edit", "Cell Structure Lab Report edited", "Introduction to Biology", "20m ago", "2026-10-15T09:40", True, "sample5"),
  nt_item("started", "play", "Chapter 5 Essay started", "Introduction to Biology", "1h ago", "2026-10-15T08:55", True, "sample6"),
  nt_item("reminder", "bell", "Chapter 5 Essay is due in 48 hours", "Introduction to Biology", "2h ago", "2026-10-15T08:00", True, "sample1"),
  nt_item("overdue", "alert", "Cell Structure Lab Report is overdue", "Introduction to Biology", "5h ago", "2026-10-15T05:00", True, "sample2"),
  nt_item("added", "calplus", "Macroeconomics Problem Set added", "Microeconomics", "Yesterday", "2026-10-14T16:20", False, "sample3"),
  nt_item("submitted", "check", "Linear Regression Analysis marked as submitted", "Statistics", "Oct 12", "2026-10-12T11:05", False, "sample4"),
  nt_item("coursenew", "book", "Statistics course added", "Statistics", "Oct 10", "2026-10-10T09:00", False, "sample7", "course.html"),
])
filters = "\n".join('              <button class="nt-chip" type="button" data-filter="%s" aria-pressed="%s">%s</button>' % (k, "true" if k == "all" else "false", l)
  for k, l in [("all","All"),("unread","Unread"),("reminders","Reminders"),("overdue","Overdue"),("added","Added"),("submitted","Submitted"),("updates","Updates"),("courses","Courses")])

notif_content = '''        <div class="notifications-page">

          <!-- LOADING (JavaScript step) -->
          <div class="nt-loading" id="nt-loading" aria-busy="true" aria-label="Loading your notifications" hidden>
            <div class="nt-sk nt-sk-head"></div>
            <div class="nt-sk nt-sk-row"></div>
            <div class="nt-sk nt-sk-row"></div>
            <div class="nt-sk nt-sk-row"></div>
          </div>

          <!-- The page could not load (usually the network) -->
          <div class="load-error" id="nt-error" role="alert" hidden>
            <p>We could not load your notifications. Check your connection and try again.</p>
            <button class="btn btn-outline-link btn-retry" type="button" id="nt-retry">Try again</button>
          </div>

          <!-- THE PAGE. Design views with sample data:
               notifications.html?state=loading | error | empty | more -->
          <div class="nt-page" id="nt-page" hidden>
            <button class="nt-back" type="button" id="nt-back" aria-label="Go back">%(back)s</button>

            <div class="nt-head">
              <h1>Notifications</h1>
              <button class="nt-markall" type="button" id="nt-markall">Mark all as read</button>
            </div>

            <div class="nt-filters" id="nt-filters" role="group" aria-label="Show">
%(filters)s
            </div>

            <p class="nt-status" id="nt-status" role="status">4 notifications</p>

            <ul class="nt-list" id="nt-list">
%(items)s
            </ul>

            <!-- Shown when there are more than 20. Each press shows 20 more. -->
            <button class="nt-more" type="button" id="nt-more" hidden>Show more</button>

            <!-- Shown when there is nothing to list (the words change for each filter) -->
            <div class="nt-empty" id="nt-empty" hidden>
              <span class="nt-empty-icon">%(check)s</span>
              <strong id="nt-empty-title">You are all caught up</strong>
              <p id="nt-empty-text">New alerts will show up here.</p>
            </div>
          </div>
        </div>''' % dict(back=ic("back"), filters=filters, items=items, check=ic("check"))
emit('notifications.html', page("Notifications", "notifications", sprite(["back","bell","alert","calplus","check","play","edit","book"]), notif_content, "notifications"))
finish()
