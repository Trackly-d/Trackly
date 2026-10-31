/* ==========================================================
   TRACKLY consent worker: shared logic
   Pure helpers (no Cloudflare needed) so tests/worker-consent.test.mjs can run them in Node.
   - random codes, and the scrambling (hashing) of tokens and parent emails
   - the approval email (words and layout)
   - sending it through Resend
   Nothing here logs an email address, a token or a key.
   ========================================================== */

import { b64encode } from "../worker-calendar/lib.js";

const enc = new TextEncoder();
const hex = (bytes) => Array.from(new Uint8Array(bytes)).map((b) => b.toString(16).padStart(2, "0")).join("");

/* A random code that cannot be guessed. 16 bytes for the public id, 32 for the secret token in the email link. */
export function randomCode(bytes = 16) {
  return b64encode(crypto.getRandomValues(new Uint8Array(bytes)), true);
}

export async function sha256Hex(text) {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(String(text))));
}

/* A scrambled copy that only we can recompute, because it needs our secret (the "pepper").
   Someone who steals the database cannot turn these back into emails or guess them from a list. */
export async function hmacHex(secret, text) {
  const key = await crypto.subtle.importKey("raw", enc.encode(String(secret)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(String(text))));
}

/* The link in the email. The token is the only secret in it. */
export function approvalLink(siteUrl, token) {
  return String(siteUrl).replace(/\/+$/, "") + "/parent-approval?token=" + encodeURIComponent(token);
}

const FONT = "Arial,Helvetica,sans-serif";

/* The email a parent or guardian receives. Email apps ignore most CSS, so everything is inline. */
export function buildEmail({ link, siteUrl, days = 7 }) {
  const subject = "Please approve a Trackly account";
  const base = String(siteUrl).replace(/\/+$/, "");
  const text = [
    "Hello,",
    "",
    "Someone asked to create a Trackly account and gave this email address as their parent or guardian. Trackly is a free app that helps students keep track of their courses and assignment deadlines.",
    "",
    "Because they are under 18, the Nigeria Data Protection Act 2023 says a parent or guardian must approve first. The account is only created if you approve.",
    "",
    "Review and approve: " + link,
    "",
    "The link works for " + days + " days and can be used once.",
    "",
    "Not expecting this? Ignore this email and nothing will be created. We do not keep your email address in readable form: only a scrambled copy, and only if you approve, as proof of your consent.",
    "",
    "Trackly, " + base.replace(/^https?:\/\//, "")
  ].join("\n");

  const html =
    '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>' +
    '<body style="margin:0;padding:24px 12px;background:#F1F5F9;font-family:' + FONT + ';color:#0F172A">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#FFFFFF;border-radius:12px;border:1px solid #E2E8F0">' +
    '<tr><td style="padding:24px 28px;text-align:center;background:#0E5C4A;border-radius:12px 12px 0 0">' +
    '<img src="' + base + '/assets/images/icon-192.png" alt="Trackly" width="56" height="56" style="display:block;margin:0 auto;border-radius:12px;background:#FFFFFF"></td></tr>' +
    '<tr><td style="padding:28px 28px 6px 28px"><h1 style="margin:0 0 12px 0;font-size:21px;line-height:1.3">A student needs your approval</h1>' +
    '<p style="margin:0 0 12px 0;font-size:15px;line-height:1.6">Hello,</p>' +
    '<p style="margin:0 0 12px 0;font-size:15px;line-height:1.6">Someone asked to create a Trackly account and gave this email address as their parent or guardian. Trackly is a free app that helps students keep track of their courses and assignment deadlines.</p>' +
    '<p style="margin:0 0 20px 0;font-size:15px;line-height:1.6">Because they are under 18, the Nigeria Data Protection Act 2023 says a parent or guardian must approve first. The account is only created if you approve.</p></td></tr>' +
    '<tr><td style="padding:0 28px 8px 28px;text-align:center"><a href="' + link + '" style="display:inline-block;padding:14px 30px;background:#00C58E;color:#FFFFFF;font-size:16px;font-weight:bold;text-decoration:none;border-radius:8px">Review and approve</a></td></tr>' +
    '<tr><td style="padding:18px 28px 28px 28px">' +
    '<p style="margin:0 0 10px 0;font-size:13px;line-height:1.6;color:#64748B">The link works for ' + days + ' days and can be used once. If the button does not work, copy this address into your browser:</p>' +
    '<p style="margin:0 0 14px 0;font-size:12px;line-height:1.5;color:#64748B;word-break:break-all">' + link + '</p>' +
    '<p style="margin:0;font-size:13px;line-height:1.6;color:#64748B"><strong>Not expecting this?</strong> Ignore this email and nothing will be created. We do not keep your email address in readable form: only a scrambled copy, and only if you approve, as proof of your consent.</p></td></tr></table>' +
    '<p style="max-width:520px;margin:12px auto 0 auto;font-size:11px;color:#94A3B8;text-align:center">Trackly, ' + base.replace(/^https?:\/\//, "") + "</p></body></html>";
  return { subject, html, text };
}

/* Sends through Resend (https://resend.com/docs/api-reference/emails/send-email). Returns { ok }. */
export async function sendEmail(env, { to, subject, html, text }, fetchFn = fetch) {
  try {
    const res = await fetchFn("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject, html, text })
    });
    return { ok: res.status >= 200 && res.status < 300, status: res.status };
  } catch (err) {
    return { ok: false, status: 0 };
  }
}
