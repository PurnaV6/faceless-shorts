-- Run this once in the Supabase SQL editor, after queue.sql.
create table if not exists series (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  total_episodes int not null,
  -- Locked from episode 1's output, then reused verbatim by every later
  -- episode so the same character/art style recur across all 15 videos.
  visual_style text,
  character_description text,
  character_reference_image_url text,
  narrator_gender text,
  -- Short running plot summary, appended to after each episode renders, so
  -- the next episode's script can continue the story instead of drifting.
  running_summary text not null default '',
  created_at timestamptz not null default now()
);

alter table storyline_queue
  add column if not exists series_id uuid references series(id),
  add column if not exists episode_number int;

alter table series enable row level security;
