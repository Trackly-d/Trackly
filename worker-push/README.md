# Trackly push worker

Sends push notifications to a student's phones and computers, even when Trackly is closed.

What it does, in plain words:

1. **Events.** When a student adds, starts, edits or submits something on one device, Trackly tells this Worker, and the Worker pushes it to ALL their devices, including the one that did it.
2. **Timed alerts.** Every minute the Worker sends the "due soon" and "overdue" pushes whose time has come. It uses the same times as the alerts inside Trackly (`js/push-logic.js` is shared by the website and the Worker, and a test proves they agree).

It stores, in a Cloudflare database (D1): each allowed device's push address, the student's push choices, and the title, course and due time of open assignments. All of it is removed when the student switches push off on their last device, logs out on that device, or deletes their account.

## Set up (once)

Everything below runs in the VS Code terminal on your computer. You never paste a secret into a chat or a file in the project.

1. Open the Worker folder and install its tool:

       cd worker-push
       npm install

2. Make the two keys:

       node make-vapid-keys.mjs

   It prints a **PUBLIC** key and a **PRIVATE** key.
   - Put the PUBLIC key in two places: `VAPID_PUBLIC_KEY` in `wrangler.toml`, and `VAPID_PUBLIC_KEY` in `js/push-config.js`.
   - Keep the PRIVATE key for step 5. Do not save it in any file.

3. Create the database and paste its id into `wrangler.toml` (where it says `PASTE_THE_ID_FROM_THE_TERMINAL_HERE`):

       npx wrangler d1 create trackly-push

4. Create the tables:

       npx wrangler d1 execute trackly-push --remote --file=schema.sql

5. Store the private key inside Cloudflare. The command asks you to paste it: paste the one line of text you got in step 2, then press Enter.

       npx wrangler secret put VAPID_PRIVATE_JWK

6. Send the Worker live:

       npx wrangler deploy

   It prints the Worker's address. Make sure `PUSH_WORKER_URL` in `js/push-config.js` is that address.

7. Deploy the website as usual (`firebase deploy --only hosting`).

Then run `node tests/run-all.mjs` from the project folder. All tests must pass before you deploy.

## Check that it works

- Open `https://YOUR-WORKER-ADDRESS/` in a browser. You should see `{"ok":true,"service":"trackly-push"}`.
- In Trackly, open Settings, switch Push notifications on, and choose Allow.
- Add an assignment. Every device with push on, including the one you added it on, shows a notification.
- To watch the Worker work: `npx wrangler tail` (leave it running, press Ctrl+C to stop). It never prints push addresses or keys.

## Free plan limits (checked in October 2026)

- Free Workers get 10 ms of CPU per run and about 50 outside calls and 50 database queries per run. The every minute job is built to stay inside that: at most 8 pushes and 16 assignments per minute, and the rest go out the next minute.
- If `wrangler tail` ever shows "Exceeded CPU" or pushes arrive late, the plan is to move this Worker to Workers Paid (about $5 a month). Nothing else needs to change.
- One Worker cron trigger is used out of the 5 a free account gets.

## Notes

- This Worker imports two files from outside its folder: `../js/push-logic.js` and `../worker-calendar/lib.js`. Keep both folders in the project.
- iPhone and iPad only get push when Trackly is added to the Home Screen (iOS 16.4 or newer). Safari also requires every push to show a notification, which the service worker (`sw.js`) always does.
- A push address belongs to one student. If someone else signs in on the same browser and switches push on, it moves to them.
