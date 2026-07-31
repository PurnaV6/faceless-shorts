# Faceless Shorts Pipeline

You submit a one-line storyline through a private web form. The pipeline
expands it into a full narration script, voices it with ElevenLabs, generates
a recurring animated main character across a set of AI scene images in one
consistent art style, animates them with Ken Burns pans/zooms, burns in
tightly-paced captions, and publishes it to YouTube Shorts and Instagram
Reels — once a day, only on days you've actually submitted a storyline.

## What it does

0. `web/` — a small hosted form (deployed on Vercel) where you paste a
   storyline idea + a passphrase. It queues the idea in a Supabase table
   (`storyline_queue`).
1. `generateScript.ts` — pulls the oldest pending storyline from the queue
   and asks OpenAI to expand it into a full ~45-60s fictional script,
   classifying it into crime/love/fun, fictionalizing any real names/events,
   and producing a consistent `visual_style`, a detailed `character_description`
   for the one recurring main character, and 5 `scene_prompts`. If the queue
   is empty, the run exits cleanly and **posts nothing that day**.
2. `tts.ts` — narrates it with ElevenLabs, which returns word-level timing
   alignment directly (no separate transcription step needed).
3. `generateImages.ts` — generates the first scene with OpenAI `gpt-image-1`,
   then generates every later scene with `images.edit`, feeding that first
   image back in each time as the character reference so the same character
   recurs across all 5 scenes instead of looking like a different person
   each cut.
4. `assemble.ts` — ffmpeg turns each scene image into a slow zoom/pan clip
   (duration weighted by how many narration words it covers), concatenates
   them, and burns in 2-word caption bursts synced to the narration.
5. `uploadYoutube.ts` / `uploadInstagram.ts` — publish the result.

Run the pipeline with `npm run run:daily`, or let the included GitHub Actions
workflow (`.github/workflows/daily.yml`) check the queue once a day and
publish automatically when there's something in it.

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
Used for script writing and scene image generation (`gpt-image-1`: 1 initial
generate call + 4 character-consistent edit calls per video). Image
generation is the bigger cost driver here — budget roughly $0.25-0.40/video
depending on size/quality settings.

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
Used for two things: (a) temporary public hosting so Instagram's API can
fetch the rendered video by URL, and (b) the storyline queue the web form
writes to.
1. Create a project at https://supabase.com if you don't have one.
2. Storage → create a public bucket, e.g. `faceless-shorts-renders`.
3. SQL Editor → paste and run `supabase/queue.sql` to create the
   `storyline_queue` table.
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
npm run run:daily   # picks up the queued storyline, renders, uploads
```

If nothing's in the queue, this exits with "No storyline queued today —
skipping this run." and does nothing else — no render, no upload.

## Automating daily uploads

Push this repo to GitHub, add every `.env` value as a repository secret
(Settings → Secrets and variables → Actions), and the included workflow
(`.github/workflows/daily.yml`) will check the queue once a day and publish
automatically whenever you've submitted a storyline through the form. It also
commits `state/used-stories.json` back as a record of what's been posted.

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
