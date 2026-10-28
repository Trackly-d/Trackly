-- TRACKLY push worker: the database (Cloudflare D1)
-- Run once:  npx wrangler d1 execute trackly-push --remote --file=schema.sql
-- Safe to run again: every line says IF NOT EXISTS.

-- One row per phone or computer that said Allow. The "endpoint" is the push service's address for that device.
CREATE TABLE IF NOT EXISTS device (
  endpoint_hash TEXT PRIMARY KEY,
  uid TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS device_uid ON device (uid);

-- One row per student: the alert times and which kinds of push are on (copied from Settings by the website).
CREATE TABLE IF NOT EXISTS prefs (
  uid TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1,
  hours TEXT NOT NULL DEFAULT '[48,24]',
  types TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL
);

-- One row per open assignment that has push alerts still to send.
-- state: 0 = needs the next time worked out, 1 = next push is waiting at next_at, 2 = nothing left to send.
CREATE TABLE IF NOT EXISTS watch (
  uid TEXT NOT NULL,
  aid TEXT NOT NULL,
  title TEXT NOT NULL,
  course TEXT NOT NULL DEFAULT '',
  due_ms INTEGER NOT NULL,
  created_ms INTEGER NOT NULL,
  state INTEGER NOT NULL DEFAULT 0,
  next_at INTEGER,
  next_kind TEXT,
  next_hours INTEGER,
  PRIMARY KEY (uid, aid)
);
CREATE INDEX IF NOT EXISTS watch_due ON watch (state, next_at);
