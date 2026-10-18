-- WordSprout: remember when each student last viewed their messages.
-- Optional. The new-message indicator works without it (it then remembers per browser);
-- this column lets "seen" follow a student to another device.
-- Safe to run more than once.

alter table public.profiles
  add column if not exists messages_seen_at timestamptz;
