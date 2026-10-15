# Trackly calendar worker: setup

This Worker adds and removes the student's Trackly reminders in their Google Calendar.
It is a **separate Worker** from your image Worker (`worker/` folder). Do not mix them.

**Where this folder goes:** inside your project, next to the `worker` folder:

```
trackly/
  worker/            (images, already deployed, do not touch)
  worker-calendar/   (this folder)
```

Run every command below inside the `worker-calendar` folder (the one with `wrangler.toml` in it).
If `wrangler --version` already works on your computer, you can leave off `npx` from each command.

## What is safe where

| Thing | Where it lives |
|---|---|
| Google client secret | Worker secret only (step 2). Never in a file, never in chat, never on GitHub. |
| Master key | Worker secret only (step 2). Encrypts every stored Google token. |
| Google token of a student | Worker KV box, **encrypted**. Never in Firestore, never in the browser. |
| Client ID, project ID, redirect address | `wrangler.toml` (these are not secret) |

Nothing important is saved in the browser. The website only holds the student's normal Firebase sign in.

## Step 1: create the KV box (once)

```
npx wrangler kv namespace create CALENDAR
```

It prints a line with an `id`. Open `wrangler.toml` and paste that id in place of
`PASTE_THE_ID_FROM_THE_TERMINAL_HERE`. Keep the quotes.

## Step 2: set the two secrets (once)

**Google client secret.** Run the command, then paste the secret when it asks (you will not see it as you paste):

```
npx wrangler secret put GOOGLE_CLIENT_SECRET
```

Get the value from Google Cloud Console, APIs and Services, Credentials, your Web client.
If the secret was ever pasted somewhere public, make a new one there first.

**Master key.** First make a random key (this prints one line of letters and numbers; copy it):

```
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Then store it:

```
npx wrangler secret put MASTER_KEY
```

Paste that line at the prompt. **Keep a copy somewhere private** (a password manager is ideal).
If it is ever lost or changed, every student has to press Connect again, because their stored tokens
can no longer be opened. Nothing else breaks.

## Step 3: Google Cloud Console (the project that has your Calendar API)

1. Credentials, your Web client, **Authorized redirect URIs**, add exactly:
   `https://trackly-calendar.trackly409.workers.dev/google/callback`
   then Save. It can take a few minutes to start working.
2. Google Auth Platform, Data access: the scope `https://www.googleapis.com/auth/calendar.events.owned` is added.
3. Audience: publishing status **Testing**, and every Google account that will try Connect is a **test user** (up to 100).
4. The Google Calendar API is enabled.

You do not need to add your local website (for example `localhost:5500`) as a redirect. That is your website, not this Worker.

## Step 4: deploy

```
npx wrangler deploy
```

## Step 5: check it works

1. Open `https://trackly-calendar.trackly409.workers.dev/` in the browser. You should see
   `{"ok":true,"service":"trackly-calendar"}`.
2. Open `https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com`.
   You should see JSON with a list called `keys`. The Worker uses this to check Firebase sign ins.
   If it does not load for you, tell me before going on.
3. Open `https://trackly-calendar.trackly409.workers.dev/calendar/status`. You should see
   `{"error":"origin_not_allowed"}`. That is correct: only your website may use it.
4. `npx wrangler tail` shows live logs while you test later. Tokens are never printed there.

## The routes

| Route | What it does |
|---|---|
| `POST /google/start` | gives the website the Google permission link |
| `GET /google/callback` | Google sends the student here, the token is stored, then back to Profile |
| `GET /calendar/status` | connected, disconnected, or reconnect |
| `POST /calendar/events` | creates the due event and the daily 8:00 AM series |
| `POST /calendar/delete` | removes events by id (only ones Trackly made) |
| `POST /calendar/disconnect` | removes every Trackly event, revokes access, forgets the token |

Every route except the health check and the callback needs the student's Firebase sign in and a website
from `ALLOWED_ORIGINS`. Add your Firebase Hosting address to `ALLOWED_ORIGINS` in `wrangler.toml` when you deploy
the site, then run `npx wrangler deploy` again.

## If the browser shows a CORS error

A message like "blocked by CORS policy" almost always means the address in your browser bar is not in
`ALLOWED_ORIGINS` in `wrangler.toml`. Look at the exact start of the address (for example `http://localhost:5500`),
add that exact text to the list, then run `npx wrangler deploy` again. `localhost` and `127.0.0.1` count as
different websites, and so does every port number.

## Good to know

- **Weekly reconnect while testing.** While the Google app is in Testing, Google expires each student's
  permission after about seven days. Profile then shows "Reconnect". Verifying the app with Google removes this.
- **Popups, not alarms.** The reminders are Google Calendar popups. They follow each student's own Calendar
  notification settings, so they are not guaranteed alarms.
- **Free plan limit.** A Worker request may make about 50 outside calls. A big clean up on Disconnect
  therefore runs in batches, and the website calls again until it says `done`.
- **Local testing.** Run `node tests/run-all.mjs` from the project folder. The tests use a pretend Google, so
  they need no secrets and no internet.