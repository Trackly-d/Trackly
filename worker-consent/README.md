# Trackly consent worker

Handles parental approval for students under 18, with a real email to the parent or guardian.

The journey, in plain words:

1. A student picks **Secondary School** and types a parent or guardian email. This Worker emails the parent an approval link.
2. The student's screen waits. The parent opens the link and taps **Approve** or **Decline**.
3. After approval the student can create an account. The account "claims" the approval, so **one approval works for one account only**.

What it keeps:

- **No readable email address.** It keeps scrambled copies (using a secret only you hold), so a stolen database cannot be turned back into emails.
- A request that is not approved, or not used, is deleted after **7 days** (an hourly cleanup does this). A declined request is wiped at once.
- An approval that was used is kept as proof of consent, **until that student's account is deleted**. Deleting the account in Settings removes it.

## Set up (once)

You never paste a secret into a chat or a file in the project. Every command runs in `C:\Users\owner\Trackly\worker-consent` unless it says otherwise.

### 1. Email: Resend (free plan: 100 emails a day, 3,000 a month)

1. Make a free account at https://resend.com.
2. In Resend open **Domains**, choose **Add Domain**, and enter `trackly.ng`.
3. Resend shows a few DNS records (SPF and DKIM). Add each one exactly as shown where your `trackly.ng` DNS is managed, then press **Verify** in Resend. It can take a few minutes, sometimes longer.
4. In Resend open **API Keys**, create a key with permission to **send emails**, and keep the key for step 4 below.

### 2. The Worker and its database

       npm install
       npx wrangler d1 create trackly-consent

Paste the `database_id` it prints into `wrangler.toml` (where it says `PASTE_THE_ID_FROM_THE_TERMINAL_HERE`). Then:

       npx wrangler d1 execute trackly-consent --remote --file=schema.sql

Answer **Y** if it asks to continue.

### 3. The scrambling secret (the "pepper")

Make a long random text and store it. This prints one:

       node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

Then run this, and paste that text at the prompt (nothing shows on screen, that is normal):

       npx wrangler secret put CONSENT_PEPPER

**Keep a copy of it in your password manager.** If you ever lose it, old consent records can no longer be matched to an email address.

### 4. The Resend key

       npx wrangler secret put RESEND_API_KEY

Paste the key from step 1 at the prompt.

### 5. Check the sender, then send it live

Open `wrangler.toml` and check `MAIL_FROM`. It must be an address on the domain you verified, for example `Trackly <no-reply@trackly.ng>`.

       npx wrangler deploy

It prints the Worker's address. Make sure `CONSENT_WORKER_URL` in `js/consent-config.js` is that address. Then deploy the website: `firebase deploy --only hosting`.

Run `node tests/run-all.mjs` from the project folder before you deploy. All tests must pass.

## Check that it works

- Open the Worker's address in a browser. You should see `{"ok":true,"service":"trackly-consent"}`.
- On the website: **Create account**, choose **Secondary School**, enter an email you can open, tick the box, and send. The approval email should arrive in a minute (check spam the first time).
- Open the link in the email and approve. The student's page should move on by itself within about 10 seconds.
- To watch the Worker: `npx wrangler tail` (Ctrl+C to stop). It never prints emails, tokens or keys.

## Limits and protections

- At most **80 emails a day** in total (Resend's free plan stops at 100), 5 requests an hour from one network, and 2 a day to one parent email.
- If the 80 a day limit is reached, students are told to try again tomorrow. If that happens, move Resend to a paid plan.
- This Worker uses one of the 5 free cron triggers on your Cloudflare account (the push Worker uses another).
- The check lives on the website and the Worker. A determined person who skips the website can still make an account through Firebase directly, because the free Firebase plan cannot block that. The rule that matters in practice: nobody can **claim** a parent's approval twice, and a secondary school student cannot get a record of consent without a real approved link.

## Notes

- This Worker imports `../js/consent-logic.js` and `../worker-calendar/lib.js`. Keep both folders in the project.
- Approval confirms that the person who received the email chose to approve. It cannot prove that person is the student's parent.
