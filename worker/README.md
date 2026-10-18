# Trackly image worker: setup

This Worker finds a photo for a course title using Pixabay.
Your Pixabay key stays inside the Worker, so it never reaches the website code.

You can set it up from the **terminal with Wrangler** (Way 1, the one you already know)
or from the **Cloudflare website** (Way 2). Pick one way and stay with it,
because mixing them can overwrite each other's settings.

Files in this folder:

| File | What it is |
|---|---|
| `index.js` | the Worker code |
| `wrangler.toml` | the settings Wrangler reads |
| `package.json` | lets you run `npm run dev`, `npm run deploy`, `npm run logs` |
| `.dev.vars.example` | where your key goes when testing on your own computer |
| `.gitignore` | keeps your key and junk files off GitHub |

---

## Way 1: terminal with Wrangler

Run everything inside this `worker` folder (the one with `wrangler.toml` in it).

**Already have Wrangler installed on your computer (`wrangler --version` works)?**
Then leave off `npx` from every command below, skip step 2, and you can delete
`package.json`, because it is only a shortcut file. This Worker is plain JavaScript,
with no React and no build step, so nothing else changes.
If Wrangler is old, update it with `npm install -g wrangler@latest`.
If `wrangler kv namespace create CACHE` is not recognised, your Wrangler is old.
Older versions wrote it as `wrangler kv:namespace create CACHE`.

1. **Go into the folder**

       cd worker

2. **Install Wrangler once** (this downloads it, so do it while you have data)

       npm install --save-dev wrangler

3. **Log in to Cloudflare** (a browser opens, click Allow)

       npx wrangler login

4. **Create the KV storage box**

       npx wrangler kv namespace create CACHE

   It prints a block that looks like this:

       [[kv_namespaces]]
       binding = "CACHE"
       id = "a1b2c3d4e5f6..."

   Copy only the `id` value and paste it into `wrangler.toml`, replacing
   `PASTE_THE_ID_FROM_THE_TERMINAL_HERE`. Keep the quotation marks.

5. **Deploy the Worker**

       npx wrangler deploy

   At the end it prints your Worker address, something like
   `https://trackly-images.your-name.workers.dev`. Copy it.

6. **Add your Pixabay key as a secret** (paste it when asked; nothing shows on screen while you paste, then press Enter)

       npx wrangler secret put PIXABAY_KEY

7. **Test it.** Open this in your browser, using your own address:

       https://trackly-images.your-name.workers.dev/images?q=Introduction%20to%20Biology

   You should see text with a list called `results`.
   If you see "The photo service is not set up yet", the secret in step 6 was not saved.

8. **Connect the website.** Paste the address (without `/images`) into `IMAGE_WORKER_URL`
   in `js/images.js`.

### Testing on your own computer first (optional, saves deploys)
1. Copy `.dev.vars.example` to a new file named `.dev.vars` and put your key in it.
2. Run `npx wrangler dev`. It starts at `http://localhost:8787`.
3. Open `http://localhost:8787/images?q=Biology` in your browser.
4. For the website to use it while testing, put `http://localhost:8787` in `IMAGE_WORKER_URL`.
   Change it back to the real address before you publish.

### Changing things later
- **Changed the code?** Run `npx wrangler deploy` again.
- **Changed `ALLOWED_ORIGINS`?** Edit it in `wrangler.toml`, then `npx wrangler deploy`.
- **Something is not working?** Run `npx wrangler tail` and then use the website.
  The Worker's messages and errors appear live in the terminal.
- **New Pixabay key?** Run `npx wrangler secret put PIXABAY_KEY` again.

### If the login does not work on a weak connection
Create an API token in Cloudflare (My Profile, API Tokens, "Edit Cloudflare Workers" template)
and set two environment variables, `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`,
then run the commands without `wrangler login`.

---

## Way 2: Cloudflare website (no terminal)

(Cloudflare sometimes renames menus. Look for the closest name.)

1. **Workers & Pages**, **Create**, **Create Worker**. Name it `trackly-images`, click **Deploy**.
2. **Edit code**, delete what is there, paste all of `index.js`, then **Deploy**.
3. **Settings**, **Variables and Secrets**, **Add**: type **Secret**, name `PIXABAY_KEY`, paste your key.
4. **Storage & Databases**, **KV**, create a namespace named `trackly-cache`.
   Then in your Worker, **Settings**, **Bindings**, **Add**, **KV namespace**,
   variable name `CACHE`, choose `trackly-cache`.
5. Optional: add a Variable `ALLOWED_ORIGINS` with the allowed website addresses separated by commas.
6. Test with the same `/images?q=...` address as above, then paste the Worker address
   into `IMAGE_WORKER_URL` in `js/images.js`.

---

## Deleting photos (new)

Trackly can now delete a student's photos from Cloudinary when they remove a photo or delete their account.
The browser cannot do that itself, because it needs your Cloudinary secret, so it asks this Worker.

**Add these settings (do NOT replace your `wrangler.toml`, it holds your real KV id; just add the lines):**

```
FIREBASE_PROJECT_ID = "trackly-e18d8"
CLOUDINARY_CLOUD_NAME = "your-cloud-name"
```

under `[vars]`, then set the two secrets (a hidden prompt asks for each value):

```
npx wrangler secret put CLOUDINARY_API_KEY
npx wrangler secret put CLOUDINARY_API_SECRET
```

Get the key and secret from your Cloudinary dashboard, Settings, API Keys. Then run `npx wrangler deploy` again.
On the Cloudflare website instead: paste the new `index.js`, add the two Variables and the two Secrets by those names.

Also add your Firebase Hosting addresses to `ALLOWED_ORIGINS` if you have not yet:
`https://trackly-e18d8.web.app,https://trackly-e18d8.firebaseapp.com`.

**How it stays safe.** Every delete call must carry the student's Firebase sign in, which the Worker checks. It deletes only
the picture ids named in the call (at most 50), and ids are long random strings that nobody else can see. For one more lock, set
`IMAGE_FOLDER_PREFIX` to the folder your uploads go in (for example `trackly/`), and the Worker will refuse any id outside it.
The API secret is never sent to the website and never written to the logs.

**Check it:** open `https://YOUR-WORKER.workers.dev/images/delete` in the browser. You should see the normal
`{"ok":true,"service":"trackly-images"}` (a plain visit is not a POST, so nothing is deleted).

---

## Safety reminders
- Never write your Pixabay key in `wrangler.toml`, `index.js`, or any website file.
- Never send it in a chat. If it was ever shared, create a new one in your Pixabay account
  and run `npx wrangler secret put PIXABAY_KEY` again.
  
- `.dev.vars` must never go on GitHub. The `.gitignore` here already blocks it.