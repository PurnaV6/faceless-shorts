-- Run this once in the Supabase SQL editor, after queue.sql.
create table if not exists series (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  total_episodes int not null,
  -- Locked from episode 1's output, then reused verbatim by every later
  -- episode so the same character/art style recur across the full series.
  visual_style text,
  character_description text,
  -- Locked multi-character identities and plot rules. These prevent the
  -- writer and image prompts from changing a character or revealing a clue
  -- before its planned episode.
  character_roster jsonb not null default '[]'::jsonb,
  continuity_bible jsonb,
  character_reference_image_url text,
  narrator_gender text,
  target_duration_seconds int not null default 45,
  scene_count int not null default 5,
  -- Short running plot summary, appended to after each episode renders, so
  -- the next episode's script can continue the story instead of drifting.
  running_summary text not null default '',
  created_at timestamptz not null default now()
);

alter table storyline_queue
  add column if not exists series_id uuid references series(id),
  add column if not exists episode_number int;

-- Safe upgrades for projects that created the original table already.
alter table series
  add column if not exists character_roster jsonb not null default '[]'::jsonb,
  add column if not exists continuity_bible jsonb,
  add column if not exists target_duration_seconds int not null default 45,
  add column if not exists scene_count int not null default 5;

alter table series enable row level security;
