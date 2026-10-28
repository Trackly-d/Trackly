"""
Writes privacy.html, terms.html and contact.html (the public legal pages).

HOW TO USE (needs Python 3, no extra packages; run it from the project folder):
  python generate-legal-pages.py            writes the pages
  python generate-legal-pages.py --check    changes NOTHING; says whether the pages on disk match what this script would write

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


import html as H
# ---- Facts shown on the pages. CHANGE THE EMAIL HERE, then run the script, and all three pages agree. ----
EMAIL = "trackly409@gmail.com"   # the contact address shown on the privacy, terms and contact pages

# The "Last updated" date comes from TERMS_VERSION in js/users.js, so the pages and the sign up record can never disagree.
import re as _re
_m = _re.search(r'TERMS_VERSION\s*=\s*"(\d{4})-(\d{2})-(\d{2})"', (ROOT / "js" / "users.js").read_text(encoding="utf-8"))
_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
DATE_TEXT = "%d %s %s" % (int(_m.group(3)), _MONTHS[int(_m.group(2)) - 1], _m.group(1))
SCOPE = "https://www.googleapis.com/auth/calendar.events.owned"
LIMITED = "Trackly's use and transfer to any other app of information received from Google APIs will adhere to the <a href=\"https://developers.google.com/terms/api-services-user-data-policy\">Google API Services User Data Policy</a>, including the Limited Use requirements."
MAIL = '<a href="mailto:%s">%s</a>' % (EMAIL, EMAIL)

HEAD = '''<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>%(title)s | Trackly</title>
  <meta name="description" content="%(desc)s">
  <meta name="robots" content="index, follow">

  <!-- Inter font -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">

  <link rel="canonical" href="%(canon)s">
  <link rel="icon" href="favicon.ico" sizes="48x48">
  <link rel="icon" type="image/png" sizes="96x96" href="assets/images/favicon-96.png">
  <link rel="apple-touch-icon" href="assets/images/apple-touch-icon.png">

  <link rel="stylesheet" href="css/base.css">
  <link rel="stylesheet" href="css/legal.css">
  <!-- App install and push (PWA) -->
  <link rel="manifest" href="/manifest.webmanifest">
  <meta name="theme-color" content="#0E5C4A">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-title" content="Trackly">
</head>
<body>
  <!--
    Public legal page. Written to match what Trackly really does (checked against the code by tests/legal-pages.test.mjs).
    Not legal advice: a Nigerian lawyer should review it before launch.
    When you change it: update "Last updated" below AND TERMS_VERSION in js/users.js (they must match).
    The terms page shows the same date, so update its "Last updated" line too.
    Keep exactly 13 numbered sections (the test counts them). Add new points inside the existing sections.
    Google also reads this page when it verifies the Calendar permission, so every statement must stay true.
  -->
  <header class="legal-header">
    <a class="legal-logo" href="index.html" aria-label="Trackly home">
      <img src="assets/images/logo.webp" alt="Trackly" width="360" height="114">
    </a>
    <a class="legal-back" href="index.html">Back to Trackly</a>
  </header>

  <div class="legal-wrap">
    <aside class="legal-side">
      <details class="legal-toc" open>
        <summary>On this page</summary>
        <ol>
%(toc)s
        </ol>
      </details>
    </aside>

    <main class="legal-page">
      <h1>%(title)s</h1>
      <p class="legal-updated">Last updated: %(date)s</p>
      <p>%(intro)s</p>

      <section class="legal-summary" aria-label="Summary">
        <h2>In short</h2>
        <ul>
%(summary)s
        </ul>
      </section>

%(body)s
    </main>
  </div>

  <footer class="legal-footer">
%(footer)s
  </footer>
  <script type="module" src="/js/pwa.js"></script>
</body>
</html>
'''

def build(path, title, desc, intro, summary, sections, footer_links):
    toc, body = [], []
    for i, (sid, stitle, content, kind) in enumerate(sections, 1):
        toc.append('          <li><a href="#%s">%s</a></li>' % (sid, H.escape(stitle)))
        h = '<h2 id="%s">%d. %s</h2>' % (sid, i, H.escape(stitle))
        if kind == "google":
            body.append('      <section class="legal-google">\n        %s\n%s\n      </section>' % (h, content))
        else:
            body.append('      <section>\n        %s\n%s\n      </section>' % (h, content))
    out = HEAD % dict(canon="https://trackly.ng/" + path.replace(".html", ""), title=title, desc=desc, intro=intro, date=DATE_TEXT, toc="\n".join(toc),
        summary="\n".join("          <li>%s</li>" % s for s in summary), body="\n\n".join(body),
        footer="\n".join('    <a href="%s">%s</a>' % l for l in footer_links))
    emit(path, out)

def ul(items): return "        <ul>\n" + "\n".join("          <li>%s</li>" % i for i in items) + "\n        </ul>"
def p(t, cls=""): return '        <p%s>%s</p>' % (' class="%s"' % cls if cls else "", t)
def h3(t): return "        <h3>%s</h3>" % t

# ======================= PRIVACY =======================
# Some sections are kept as ready made HTML (taken from the reviewed wording). @@EMAIL@@ becomes the contact address.
def RAW(text): return text.strip("\n").replace("@@EMAIL@@", EMAIL)

privacy_sections = [
 ("s1", "Who is responsible for your information",
  "\n".join([p("Trackly is run by a team of six people in Nigeria. Trackly is not yet a registered company. Under the Nigeria Data Protection Act 2023, the Trackly team is the \"data controller\" of your information, which means we decide how and why it is used."),
   p("For privacy and data protection questions or requests, email %s. We have not named a separate Data Protection Officer, so this address reaches the people who handle your information. If the law requires us to register with the Nigeria Data Protection Commission, we will do so." % MAIL)]), ""),
 ("s2", "Information we collect", ul([
  "<strong>Account details:</strong> your full name, email address and, if you sign in with Google, your Google profile photo. Your password is handled by Google Firebase Authentication, so we cannot see it.",
  "<strong>What you add:</strong> your courses (title, code, instructor, colour and photo), your assignments (title, notes, due date, priority, status and reminder choices), and a profile photo if you upload one.",
  "<strong>Sign up record:</strong> the date you created your account, and the date and version of the terms you agreed to.",
  "<strong>Alerts and history:</strong> your alert choices in Settings, a short history of events in your account (such as an assignment or course being added, started, edited or marked as submitted), and which notifications you have read.",
  "<strong>Push notifications,</strong> only if you switch them on in Settings: a push address for each device you allow (it lets your browser's push service reach that device), which kinds of push you chose, and, for assignments that are still open, the title, course name and due time, so Trackly can send due soon and overdue alerts while it is closed.",
  "<strong>Google Calendar details,</strong> only if you connect it: see section 4.",
  "<strong>Basic technical data:</strong> information such as device and browser type, which our service providers may collect to keep Trackly working and secure."]), ""),
 ("s3", "How we use your information", ul([
  "to create your account and keep you signed in;",
  "to show your courses and assignments;",
  "to show alerts and a short history in Trackly, such as when an assignment is due soon or overdue;",
  "to send push notifications to your devices, if you switch them on;",
  "to add and remove reminder events on your Google Calendar, if you connect it;",
  "to find a suitable photo for your course header;",
  "to keep Trackly secure, fix problems and improve it;",
  "to answer your questions and meet our legal duties."]) + "\n" + p("We collect only the information Trackly needs to work, and we use it only for the reasons listed above. We do not use your information to make automated decisions that significantly affect you. Statuses such as Overdue are worked out from the due dates you enter, and they only change what you see inside Trackly."), ""),
 ("google", "Google user data and Google Calendar", "\n".join([
  p("This section explains exactly how Trackly uses Google user data. It only applies if you choose to connect Google Calendar. Signing in with Google is separate: it only gives us your name, email address and profile photo.", "legal-lead"),
  h3("What Trackly asks for"),
  p("When you switch on Google Calendar Reminders in your Profile, Google asks you to allow Trackly to use the permission <code>%s</code>. This permission lets an app view, create, change and delete events on calendars you own. It is the only Google Calendar permission we ask for, and we only use the part of it described below." % SCOPE),
  h3("What Trackly does with it"),
  ul([
   "Creates reminder events on your main Google Calendar for your assignments: a \"Due:\" event at the due time with popup reminders, and, if you use the default schedule, a repeating \"Work on:\" event each morning at 8:00 until the day before the due date. Each event contains the assignment title, the course name, the due time and a link back to the assignment in Trackly.",
   "Removes those events when they are no longer needed: when you mark the assignment Submitted, delete it, change something shown in the event, or switch Google Calendar Reminders off.",
   "Finds its own events: every event Trackly creates carries a private tag. When you switch the feature off, Trackly searches for events with that tag, and before deleting an event it checks the tag. Trackly does not read, copy, change or delete any other event in your calendar, and it does not access your email, contacts or any other Google data."]),
  h3("What we store, and where"),
  ul([
   "A long-lived Google access code (a \"refresh token\") that lets Trackly keep working after you close the page. It is encrypted and kept in our Cloudflare storage, linked only to your account. It is never stored in your browser or in our database.",
   "A short-lived Google access token, kept only in the memory of our server for a few minutes while it is used. It is not saved.",
   "In our Firebase database: the IDs of the calendar events Trackly created and your time zone (saved with each assignment), a note that Google Calendar is connected, and, briefly, a list of event ids waiting to be removed if Google could not be reached.",
   "The events themselves live in your Google Calendar, which Google controls."]),
  h3("What we never do"),
  ul([
   "We do not sell Google user data or use it for advertising.",
   "We do not share it with anyone except the providers that run Trackly for us (section 5).",
   "We do not allow people to read it unless you ask us to, it is needed for security or support, or the law requires it.",
   "We do not use it to develop or train artificial intelligence models."]),
  h3("How to stop"),
  p("Switch off Google Calendar Reminders in your Profile. Trackly removes the reminders it created, takes back its permission from Google and deletes the stored token. You can also remove Trackly's access at any time in your Google Account's third-party access settings. If you do, Trackly will notice, delete the stored token and ask you to connect again. Reminders that were already in your calendar at that point can be deleted by you in Google Calendar: look for events starting with \"Due:\" or \"Work on:\"."),
  p(LIMITED, "legal-limited")]), "google"),
 ("s5", "Who we share information with", "\n".join([
  p("We share information only with the service providers that help us run Trackly, and only as much as they need:"),
  ul([
   "<strong>Google (Firebase):</strong> sign in, our database and hosting, and Google Calendar if you connect it.",
   "<strong>Cloudinary:</strong> storing and delivering images, including photos you upload.",
   "<strong>Cloudflare:</strong> running the services that connect Trackly to Google Calendar, to photo search and to push notifications, and storing your encrypted Google Calendar token and your push settings.",
  "<strong>Your browser's push service</strong> (run by Google, Apple, Microsoft or Mozilla, depending on your browser): if you switch push on, it delivers each notification to your device. It receives your device's push address and the notification, which is encrypted so that only your device can read it.",
   "<strong>Pixabay:</strong> course photos. We send only the subject words of a course, never your name or email."]),
  p("We may also share information when the law requires it or to protect the rights and safety of Trackly or its users. We do not sell your personal information.")]), ""),
 ("s6", "Why we are allowed to use your information",
  RAW('''
        <p>The Nigeria Data Protection Act 2023, together with the Nigeria Data Protection Commission's General Application and Implementation Directive 2025, says we must have a lawful reason to use your information. We rely on:</p>
        <ul>
          <li><strong>Your consent,</strong> which you give when you create an account and agree to our terms, and when you choose to connect Google Calendar or switch on push notifications;</li>
          <li><strong>What we need to provide the service you asked for,</strong> such as saving your courses and assignments and showing you alerts;</li>
          <li><strong>Our legitimate interest</strong> in keeping Trackly safe and working, which never overrides your rights;</li>
          <li><strong>Our legal duties,</strong> where the law requires us to keep or share certain information.</li>
        </ul>
        <p>You can withdraw your consent at any time. For example, you can switch off Google Calendar Reminders in Profile, switch off push notifications in Settings, or delete your account in Settings. Withdrawing consent does not affect what we did before you withdrew it, but we will stop using your information for that purpose.</p>
'''), ""),
 ("s7", "Where your information is kept and how we protect it",
  RAW('''
        <h3>Where it is kept</h3>
        <p>Your information is stored on the servers of our service providers (Google, Cloudflare and Cloudinary), which may be outside Nigeria. When your information is handled outside Nigeria, it goes only to the providers named in section 5. We choose providers that publish their own data protection commitments and use industry standard security, and we do not send your information to anyone else abroad.</p>
        <h3>How we protect it</h3>
        <ul>
          <li>Your password is handled by Google Firebase Authentication, so we cannot see it.</li>
          <li>Our database rules let each signed in student read and write only their own records, never another student's.</li>
          <li>Your Google Calendar token is encrypted, and it is never stored in your browser or in our database.</li>
          <li>Push notifications are encrypted from our server to your device, so the push service that delivers them cannot read them.</li>
          <li>Information moves between your device and Trackly over secure (HTTPS) connections.</li>
        </ul>
        <p>No system is completely secure, but we work to keep your information safe and we review how we protect it when we change Trackly.</p>
        <h3>If something goes wrong</h3>
        <p>If a breach of personal data happens, we will find out what was affected and act to contain it. Where the law requires, we will tell the Nigeria Data Protection Commission within 72 hours of becoming aware of the breach. If the breach is likely to put you at high risk, we will also tell you without undue delay, in clear language, and explain what you can do to protect yourself.</p>
'''), ""),
 ("s8", "How long we keep it", ul([
  "<strong>Your account, courses and assignments:</strong> while your account is active.",
  "<strong>Your Google Calendar token:</strong> until you switch Google Calendar Reminders off, remove Trackly in your Google Account, or ask us to delete your account.",
  "<strong>Calendar event ids waiting to be removed:</strong> deleted as soon as the events are removed.",
  "<strong>Your notification history:</strong> for 30 days, then it is removed.",
  "<strong>Push notification data:</strong> your device's push address until you switch push off, log out on that device, or delete your account. The title, course name and due time of an open assignment are kept only until it is submitted, deleted or past due, or you switch push off.",
  "<strong>Photos you upload:</strong> while your account is active. We remove them when your account is deleted, and when you remove or replace a photo.",
  "<strong>When you delete your account in Settings,</strong> Trackly removes your Google Calendar reminders, your push notification data, your photos, your courses, assignments and notification history, and your login, straight away.",
  "<strong>If you ask us by email instead,</strong> we delete your personal information within 30 days, unless we must keep some of it for legal reasons."]), ""),
 ("s9", "Your rights",
  RAW('''
        <p>Under the Nigeria Data Protection Act 2023, you can ask us to:</p>
        <ul>
          <li>show you the information we hold about you, and tell you how it is used;</li>
          <li>correct information that is wrong or incomplete;</li>
          <li>delete your information or close your account (you can do this yourself with Delete account in Settings);</li>
          <li>limit how we use your information;</li>
          <li>stop using your information for a purpose you object to;</li>
          <li>give you a copy of your information in a common format, so you can move it elsewhere.</li>
        </ul>
        <p>You can also withdraw your consent at any time (see section 6). You have the right not to be subject to decisions made only by automated means that significantly affect you, and Trackly does not make such decisions.</p>
        <p>Email <a href="mailto:@@EMAIL@@">@@EMAIL@@</a> and we will respond to your request within 30 days. We may first need to check that the request really comes from you, so please write from the address on your account. To delete your account, use Delete account in Settings, or email us from the address on your account.</p>
        <p>If you are not happy with how we handle your information, please tell us first so we can try to put it right. You also have the right to complain to the Nigeria Data Protection Commission (<a href="https://ndpc.gov.ng">ndpc.gov.ng</a>).</p>
'''), ""),
 ("s10", "Cookies and browser storage",
  p("Trackly uses your browser's storage to keep you signed in (for longer if you choose \"Remember me\"), to keep a short-lived copy of recent screens so pages load faster (it clears when you close the tab), and to remember a few small settings, such as which list filter you chose. If you switch on push or install Trackly, your browser also keeps a small background program for Trackly (a service worker) and a push subscription. The service worker keeps only an offline page, never your courses or assignments. We do not use advertising cookies or third-party analytics tools."), ""),
 ("s11", "Children",
  RAW('''
        <p>Trackly is meant for students aged 18 and over. Secondary school students under 18 may use Trackly only with permission from a parent or guardian. If you are under 18, you need permission from a parent or guardian before you create an account.</p>
        <p>We take extra care with the information of children. We collect only what Trackly needs to work, we never use it for advertising, and we never sell it. If we learn that we hold information about a child without that permission, we will delete it. A parent or guardian can email us to see, correct or delete their child's information.</p>
'''), ""),
 ("s12", "Changes to this policy",
  p("We may update this policy from time to time. When we make an important change, we will tell you in the app or by email. If we ever want to use Google user data in a new way, we will update this policy and ask for your permission first."), ""),
 ("s13", "Contact us", p("Email %s, or use our <a href=\"contact.html\">contact page</a>." % MAIL), ""),
]
build("privacy.html", "Privacy Policy",
  "How Trackly handles your information, including Google Calendar, and your data protection rights under the Nigeria Data Protection Act 2023. We do not sell your personal information.",
  "Your privacy matters to us. This policy explains what information Trackly collects, why we collect it, who we share it with, how we protect it, and the choices you have under the Nigeria Data Protection Act 2023. We do not sell your personal information.",
  ["We collect your name, email, courses and assignments so Trackly can work for you.",
   "We never sell your information and we do not show ads.",
   "If you connect Google Calendar, Trackly only adds and removes its own reminder events. Details are in <a href=\"#google\">section 4</a>.",
   "You can switch Google Calendar and push notifications off at any time, and delete your account yourself in Settings.",
   "Service providers (Google Firebase, Cloudinary, Cloudflare and Pixabay) help us run Trackly, as explained in section 5.",
   "You have rights over your information, including access, correction, deletion and objection. They are explained in <a href=\"#s9\">section 9</a>."],
  privacy_sections,
  [("terms.html", "Terms of Service"), ("contact.html", "Contact"), ("signup.html", "Create an account"), ("login.html#signin", "Sign in")])

# ======================= TERMS =======================
terms_sections = [
 ("s1", "Who we are", p("Trackly is run by the Trackly team in Nigeria (\"Trackly\", \"we\", \"us\"). You can reach us at %s." % MAIL), ""),
 ("s2", "Your account", ul([
  "You must give us correct information when you sign up and keep it up to date.",
  "Trackly is meant for students aged 18 and over. If you are under 18, you need permission from a parent or guardian to use it.",
  "Keep your password private. You are responsible for what happens under your account.",
  "Tell us straight away if you think someone else is using your account."]), ""),
 ("s3", "What Trackly does, and what it does not promise",
  p("Trackly helps you organise your courses and assignments and sends reminders. It is a helper, not a guarantee. Reminders that appear in Google Calendar are popups that follow your own Calendar notification settings. They can be delayed or fail because of your phone, your internet, your calendar settings or other things outside our control. The same is true of push notifications, which also depend on your browser and phone allowing them. You stay responsible for your own deadlines, and you should not rely on Trackly as your only reminder for anything important."), ""),
 ("s4", "Your content", p("The courses, assignments, notes and photos you add to Trackly belong to you. You give us permission to store and process them only so we can run Trackly for you. We do not claim ownership of your work."), ""),
 ("s5", "Acceptable use", "\n".join([p("Please do not:"), ul([
  "break the law or use Trackly to harm or harass anyone;",
  "try to get into other people's accounts or our systems;",
  "upload harmful files or content you have no right to share;",
  "overload, copy or interfere with Trackly in ways that stop others using it."])]), ""),
 ("s6", "Google sign in and Google Calendar",
  p("You can sign in with Google. If you choose to connect Google Calendar, Trackly asks for your permission first. It then adds reminder events for your assignments to your main calendar, and removes them when they are no longer needed. You can switch this off in your Profile or in your Google Account settings at any time, and you can also delete the events yourself. Our <a href=\"privacy.html#google\">Privacy Policy</a> explains exactly how we handle Google data."), ""),
 ("s7", "Photos and third-party services",
  p("Trackly uses services from other companies, such as Google Firebase, Cloudinary, Cloudflare and Pixabay, and your browser's own push service if you switch on push notifications. Course header photos may come from Pixabay and are provided under Pixabay's own licence. These services have their own terms, and we are not responsible for them."), ""),
 ("s8", "Changes and availability", p("We work to keep Trackly running, but we cannot promise it will always be available or free of errors. We may add, change or remove features, and we may pause the service for maintenance."), ""),
 ("s9", "Ending your account", p("You can stop using Trackly at any time. To delete your account and your data, use Delete account in Settings. Or email us at %s from the address on your account, and we will do it within 30 days. We may suspend or close accounts that break these terms." % MAIL), ""),
 ("s10", "Limits on our responsibility", p("Trackly is provided \"as is\". To the fullest extent the law allows, we are not responsible for losses that come from missed deadlines, failed or late reminders, lost data, or interruptions to the service. Nothing in these terms limits any rights you have under Nigerian law that cannot be limited."), ""),
 ("s11", "Changes to these terms", p("We may update these terms from time to time. When we make an important change, we will tell you in the app or by email. If you keep using Trackly after a change, you accept the updated terms."), ""),
 ("s12", "Governing law", p("These terms are governed by the laws of the Federal Republic of Nigeria."), ""),
 ("s13", "Contact", p("Questions about these terms? Email %s, or use our <a href=\"contact.html\">contact page</a>." % MAIL), ""),
]
build("terms.html", "Terms of Service",
  "The rules for using Trackly, the student assignment tracker.",
  "Welcome to Trackly. These terms explain the rules for using Trackly, a tool that helps students keep track of courses, assignments, due dates and reminders. By creating an account or using Trackly, you agree to these terms.",
  ["Trackly helps you keep track of your work. Reminders help, but they are not a guarantee.",
   "Your courses, assignments, notes and photos belong to you.",
   "Please use Trackly kindly and lawfully.",
   "You can stop using Trackly and ask us to delete your account at any time.",
   "How we handle your information, including Google Calendar, is in our <a href=\"privacy.html\">Privacy Policy</a>."],
  terms_sections,
  [("privacy.html", "Privacy Policy"), ("contact.html", "Contact"), ("signup.html", "Create an account"), ("login.html#signin", "Sign in")])


# ======================= CONTACT =======================
def build_contact():
    head = HEAD.split('<div class="legal-wrap">')[0].rstrip(" ") % dict(
        canon="https://trackly.ng/contact", title="Contact Trackly",
        desc="How to contact Trackly for help, to report a problem, or to make a privacy request.")
    body = '''  <div class="legal-wrap legal-wrap-single">
    <main class="legal-page contact-page">
      <h1>Contact Trackly</h1>
      <p class="legal-updated">Questions, problems or requests? Email us and we will reply as soon as we can.</p>

      <div class="contact-cards">
        <article class="contact-card">
          <h2>Get help</h2>
          <p>Stuck on something, or not sure how a feature works?</p>
          <a class="contact-btn" href="mailto:%(e)s?subject=Trackly%%20help">Email for help</a>
        </article>
        <article class="contact-card">
          <h2>Report a problem</h2>
          <p>Something is broken, or did not look right?</p>
          <a class="contact-btn" href="mailto:%(e)s?subject=Trackly%%20problem&amp;body=What%%20happened%%3F%%0A%%0AWhich%%20page%%20were%%20you%%20on%%3F%%0A%%0AWhat%%20phone%%20or%%20computer%%20and%%20browser%%20are%%20you%%20using%%3F">Report a problem</a>
        </article>
        <article class="contact-card">
          <h2>Privacy and account requests</h2>
          <p>Ask what information we hold about you, or ask us to delete your account. You can also delete it yourself in Settings.</p>
          <a class="contact-btn" href="mailto:%(e)s?subject=Trackly%%20privacy%%20request">Send a privacy request</a>
        </article>
      </div>

      <section>
        <h2>What to put in your message</h2>
        <ul>
          <li>The email address you use for Trackly.</li>
          <li>What you were trying to do, and what happened instead.</li>
          <li>The page you were on, and your phone or computer and browser.</li>
          <li>A screenshot, if you can.</li>
        </ul>
        <p><strong>Please never send us your password.</strong> We will never ask for it.</p>
      </section>

      <section>
        <h2>Before you write</h2>
        <p>Your answer may already be in our <a href="index.html#faq">questions and answers</a>. You can also read our <a href="privacy.html">Privacy Policy</a> and our <a href="terms.html">Terms of Service</a>.</p>
      </section>

      <section>
        <h2>Email</h2>
        <p>You can also write to us directly at %(mail)s.</p>
      </section>
    </main>
  </div>

  <footer class="legal-footer">
    <a href="privacy.html">Privacy Policy</a>
    <a href="terms.html">Terms of Service</a>
    <a href="signup.html">Create an account</a>
    <a href="login.html#signin">Sign in</a>
  </footer>
  <script type="module" src="/js/pwa.js"></script>
</body>
</html>
''' % dict(e=EMAIL, mail=MAIL)
    emit("contact.html", head + body)


build_contact()
finish()
