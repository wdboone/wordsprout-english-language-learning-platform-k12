-- WordSprout: store each student's Phonics (K-12) progress.
-- Optional. Phonics works without it (progress then stays in the browser);
-- this column lets progress sync across devices.
-- Safe to run more than once.

alter table public.progress
  add column if not exists phonics jsonb;
