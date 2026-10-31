-- TRACKLY consent worker: the database (Cloudflare D1)
-- Run once:  npx wrangler d1 execute trackly-consent --remote --file=schema.sql
-- Safe to run again: every line says IF NOT EXISTS.

-- One row per request to a parent or guardian. Nothing in readable form: no email address is stored.
--   id           the public code the student's page asks with (cannot be guessed)
--   token_hash   a scrambled copy of the secret in the parent's email link
--   email_hash   a scrambled copy (needs our secret) of the parent's email, kept as proof of consent once approved
--   status       pending, approved or declined (expired is worked out from expires_at)
--   claimed_by   the student account this approval was used for. One approval can be used for ONE account.
CREATE TABLE IF NOT EXISTS request (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  email_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  answered_at INTEGER,
  claimed_by TEXT,
  claimed_at INTEGER
);
CREATE INDEX IF NOT EXISTS request_claimed ON request (claimed_by);
CREATE INDEX IF NOT EXISTS request_expires ON request (expires_at);

-- Counters that stop anyone using the form to flood a parent's inbox or use up the daily email allowance.
CREATE TABLE IF NOT EXISTS ratelimit (
  key TEXT PRIMARY KEY,
  n INTEGER NOT NULL,
  at INTEGER NOT NULL
);
