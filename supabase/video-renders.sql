-- Run after queue.sql and series.sql. A render must be explicitly changed to
-- `approved` before publishApproved.ts will send it to either platform.
create table if not exists video_renders (
  id uuid primary key default gen_random_uuid(),
  queue_id uuid not null unique references storyline_queue(id),
  series_id uuid references series(id),
  episode_number int,
  title text not null,
  display_title text not null,
  description text not null,
  tags jsonb not null default '[]'::jsonb,
  script text not null,
  recap text,
  video_url text not null,
  status text not null default 'awaiting_review'
    check (status in ('awaiting_review', 'approved', 'rejected', 'publishing', 'published', 'failed')),
  youtube_video_id text,
  instagram_media_id text,
  error_message text,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  published_at timestamptz
);

create index if not exists video_renders_approved_idx
  on video_renders (approved_at, created_at)
  where status = 'approved';

alter table video_renders enable row level security;

-- Manual approval example (replace the UUID shown in the preview issue):
-- update video_renders
-- set status = 'approved', approved_at = now(), error_message = null
-- where id = 'RENDER_UUID' and status in ('awaiting_review', 'failed');
