-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).
create table if not exists storyline_queue (
  id uuid primary key default gen_random_uuid(),
  storyline text not null,
  status text not null default 'pending' check (status in ('pending', 'awaiting_review', 'published', 'failed')),
  created_at timestamptz not null default now(),
  rendered_at timestamptz,
  used_at timestamptz
);

alter table storyline_queue add column if not exists rendered_at timestamptz;

-- Upgrade the original pending/used status constraint without deleting rows.
alter table storyline_queue drop constraint if exists storyline_queue_status_check;
update storyline_queue set status = 'published' where status = 'used';
alter table storyline_queue
  add constraint storyline_queue_status_check
  check (status in ('pending', 'awaiting_review', 'published', 'failed'));

create index if not exists storyline_queue_pending_idx
  on storyline_queue (created_at)
  where status = 'pending';

-- Row Level Security stays on; only the service_role key (used server-side by
-- the /api/submit function and the daily pipeline) can read/write this table.
alter table storyline_queue enable row level security;
