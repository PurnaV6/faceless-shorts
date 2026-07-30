-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).
create table if not exists storyline_queue (
  id uuid primary key default gen_random_uuid(),
  storyline text not null,
  status text not null default 'pending' check (status in ('pending', 'used')),
  created_at timestamptz not null default now(),
  used_at timestamptz
);

create index if not exists storyline_queue_pending_idx
  on storyline_queue (created_at)
  where status = 'pending';

-- Row Level Security stays on; only the service_role key (used server-side by
-- the /api/submit function and the daily pipeline) can read/write this table.
alter table storyline_queue enable row level security;
