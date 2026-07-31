# Faceless Shorts Pipeline

You submit a one-line storyline through a private web form. The pipeline
expands it into a full narration script, voices it with ElevenLabs, generates
a recurring animated main character across a set of AI scene images in one
consistent art style, animates them with Ken Burns pans/zooms, burns in
tightly-paced captions, and uploads a review preview. Nothing reaches
YouTube Shorts or Instagram Reels until you watch that preview and mark the
render approved in Supabase.

## What it does

0. `web/` — a small hosted form (deployed on Vercel) where you paste a
   storyline idea + a passphrase. It queues the idea in a Supabase table
   (`storyline_queue`).
1. `generateScript.ts` — pulls the oldest pending storyline from the queue
   and asks OpenAI to expand it into a full ~45-60s fictional script,
   classifying it into crime/love/fun, fictionalizing any real names/events,
   and producing a consistent `visual_style`, locked character descriptions,
   and ordered scene prompts. If the queue
   is empty, the run exits cleanly and **posts nothing that day**.
2. `tts.ts` — narrates it with ElevenLabs, which returns word-level timing
   alignment directly (no separate transcription step needed).
3. `generateImages.ts` — generates a locked cast reference with OpenAI
   `gpt-image-1`, then generates every story scene with `images.edit` from
   that same reference so identities and outfits remain stable.
4. `assemble.ts` — ffmpeg turns each scene image into a slow zoom/pan clip
   (duration weighted by how many narration words it covers), concatenates
   them, normalizes the final runtime, and burns in stacked 2-3 word caption
   bursts synced to the narration.
5. `run.ts` uploads the completed MP4 to Supabase and creates an
   `awaiting_review` row in `video_renders`.
6. `publishApproved.ts` publishes at most one render, and only when you have
   manually changed that row to `approved`.

Run the pipeline with `npm run run:daily`, or let the included GitHub Actions
workflow (`.github/workflows/daily.yml`) checks once a day. It publishes one
previously approved render, if available, then creates the next review preview.

## Prerequisites

```bash
brew install ffmpeg-full node
```

**Use `ffmpeg-full`, not plain `ffmpeg`.** Homebrew's default `ffmpeg` formula
ships without libass/freetype, so the caption-burning `subtitles` filter this
pipeline relies on doesn't exist in it — you'll get `Unknown filter
'subtitles'`. `ffmpeg-full` is keg-only (won't conflict with a regular ffmpeg
install), so point the pipeline at it explicitly:

```bash
echo 'FFMPEG_BIN=/usr/local/opt/ffmpeg-full/bin/ffmpeg' >> .env
```

(Apple Silicon Macs: that path is under `/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg`
instead — run `brew --prefix ffmpeg-full` to confirm.) On the GitHub Actions
Ubuntu runner this isn't an issue — its apt `ffmpeg` package includes libass
by default, and the workflow verifies that on every run before proceeding.

## Account setup (do this yourself — takes ~45-60 min once)

### 1. OpenAI
Create a key at https://platform.openai.com/api-keys → `OPENAI_API_KEY`.
Used for script writing and scene image generation. The Priya preset uses one
cast-reference generation plus eight character-consistent scene edits per
episode, so image generation is the main cost driver. Check current API
pricing before queueing the full series.

### 2. ElevenLabs
Sign up at https://elevenlabs.io → Profile → API key → `ELEVENLABS_API_KEY`.
Pick two voices from the Voice Library — one male, one female — and copy
their voice ids → `ELEVENLABS_VOICE_ID` (male, also the fallback) and
`ELEVENLABS_VOICE_ID_FEMALE`. `generateScript.ts` decides per-story which
fits the narrator and `run.ts` picks the matching voice automatically. This
is the single biggest lever for how professional the narration sounds —
worth spending a few minutes previewing voices before settling on one. Free
tier is limited; the Starter plan (~$5/mo) covers daily shorts comfortably.

### 3. YouTube
1. Create a project at https://console.cloud.google.com/
2. Enable **YouTube Data API v3** (APIs & Services → Library).
3. Configure the OAuth consent screen (External, publish status "Testing" is
   fine for personal use).
4. Create an OAuth client (Application type: Desktop app) →
   `YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET`.
5. Run `npm run auth:youtube` locally — it opens a browser, you approve
   access to your own channel, and it writes `YOUTUBE_REFRESH_TOKEN` into
   `.env` for you.

   **Caveat:** while your OAuth consent screen is in "Testing" status,
   Google expires refresh tokens after 7 days, which will silently break the
   daily cron. Either re-run `auth:youtube` weekly, or submit the app for
   Google's OAuth verification (required for `youtube.upload` scope) once
   you're confident in the pipeline — that removes the 7-day limit.

### 4. Supabase
Used for four things: (a) temporary public hosting so Instagram's API can
fetch the rendered video by URL, (b) the storyline queue the web form writes
to, (c) series continuity data (locked cast/style/reference image/rules and
running plot summary), and (d) the manual video-review queue.
1. Create a project at https://supabase.com if you don't have one.
2. Storage → create a public bucket, e.g. `faceless-shorts-renders`.
3. SQL Editor → run `supabase/queue.sql`, `supabase/series.sql`, then
   `supabase/video-renders.sql` in that order.
4. Project Settings → API → copy the URL and the **service_role** key (not
   the anon key) → `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`.

### 5. Instagram Reels
1. Convert your Instagram account to a Professional account and link it to a
   Facebook Page (Instagram app → Settings).
2. Create an app at https://developers.facebook.com/ (type: Business).
3. Add the **Instagram Graph API** product.
4. Get your IG user id and a long-lived access token with
   `instagram_content_publish` permission via Graph API Explorer
   → `IG_USER_ID` / `IG_ACCESS_TOKEN`.

   **Caveat:** publishing to accounts other than your own app's
   admins/testers requires Meta App Review for `instagram_content_publish`.
   For your own account in development mode it works without review.

### 6. The storyline submission form (Vercel)
This is how you actually feed it a storyline each day.
1. Create a free account at https://vercel.com if you don't have one.
2. From the `web/` folder, deploy: `npx vercel` (or connect the GitHub repo
   in Vercel's dashboard with **Root Directory** set to `web`).
3. In the Vercel project's Settings → Environment Variables, set
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (same values as your `.env`),
   and `QUEUE_SECRET` (a passphrase you make up — this is what gates who can
   submit storylines to your queue).
4. Bookmark the deployed URL on your phone. Each day, open it, type a
   storyline, enter your passphrase, submit.

## Running

```bash
npm install
cp .env.example .env   # fill in the keys above
npm run auth:youtube   # one-time
```

Then submit a storyline through the deployed web form, and run:

```bash
npm run run:daily   # renders one queued storyline and creates a preview
```

If nothing is in the queue, this exits cleanly. When a preview is ready,
`episode-summary.json` contains its watch URL and render id. After watching,
approve it in the Supabase SQL editor:

```sql
update video_renders
set status = 'approved', approved_at = now(), error_message = null
where id = 'RENDER_UUID' and status in ('awaiting_review', 'failed');
```

Then publish the oldest approved render:

```bash
npm run publish:approved
```

## Automating daily uploads

Push this repo to GitHub, add every `.env` value as a repository secret
(Settings → Secrets and variables → Actions), and the included workflow
(`.github/workflows/daily.yml`) will publish one render that you have already
approved, then render the next queued storyline for review. A manual workflow
run can do `publish-approved`, `render-preview`, or `both`. Merely adding
platform credentials cannot bypass the approval state.

## Multi-episode series

For a serialized story (same recurring character, one continuous plot cut
into N cliffhanger episodes) instead of one-off videos:

```bash
npm run queue:series -- "<overall story premise>" 15
```

This asks OpenAI to break the premise into 15 episode beats (rising tension,
final episode resolves), creates a `series` row, and queues all 15 as
`storyline_queue` rows tagged with `series_id` + `episode_number`. The daily
cron renders them in order and holds each one for review.

For the locked 18-part Priya series, do not ask the model to invent an
outline. Queue the checked-in canon directly:

```bash
npm run queue:priya
```

`config/priya-case.json` fixes all 18 beats, the six-character roster,
appearance rules, reveal limits, recurring evidence, a 45-second target, and
eight frames per episode. The uploaded overview video remains labelled
**Episode 0 — Series Trailer**; it is not placed in the numbered queue.

How continuity works under the hood:
- **Episode 1** uses the cast and style already locked on the series row. It
  creates a cast reference image that every scene and later episode uses via
  `images.edit`.
- **Later episodes** reuse the locked cast/style/voice/canon and continue the
  plot using a running summary. Reveal rules in the private series bible stop
  the writer from borrowing a later twist.
- If you submit a one-off storyline through the web form while a series is
  mid-run, it queues behind the remaining series episodes (FIFO by
  `created_at`) rather than interleaving with them.

## Things worth knowing before you scale this up

- **YouTube's reused/repetitious content policy** can make mass-produced,
  formulaic content ineligible for monetization. This pipeline varies the
  premise and category daily, but original hooks/voice/pacing still matter
  more than volume — treat this as a starting point, not a monetization
  guarantee.
- **Disclose AI-generated content** where the platform requires it (YouTube's
  "altered or synthetic content" toggle on upload).
- **Crime stories are fully fictionalized** by the prompt (no real names/cases)
  to avoid defamation risk — don't remove that constraint.
- **YouTube Shorts monetization** requires 1,000 subscribers + 10M Shorts
  views in 90 days. Instagram/TikTok bonus programs are region-gated and
  change often — check current eligibility before counting on them.
