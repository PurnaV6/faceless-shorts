# Faceless Shorts Pipeline

You submit a one-line storyline through a private web form. The pipeline
expands it into a full narration script, voices it, lays it over stock b-roll
with burned-in captions, and publishes it to YouTube Shorts and Instagram
Reels — once a day, only on days you've actually submitted a storyline.

## What it does

0. `web/` — a small hosted form (deployed on Vercel) where you paste a
   storyline idea + a passphrase. It queues the idea in a Supabase table
   (`storyline_queue`).
1. `generateScript.ts` — pulls the oldest pending storyline from the queue
   and asks OpenAI to expand it into a full ~45-60s fictional script,
   classifying it into crime/love/fun and fictionalizing any real
   names/events. If the queue is empty, the run exits cleanly and **posts
   nothing that day**.
2. `tts.ts` — narrates it with OpenAI TTS, then re-transcribes the audio with
   Whisper to get word-level timestamps for caption sync.
3. `pickBroll.ts` — searches Pexels for portrait stock video matching the
   story's mood/keywords.
4. `assemble.ts` — ffmpeg composites b-roll + narration + burned-in captions
   into a 1080x1920 mp4.
5. `uploadYoutube.ts` / `uploadInstagram.ts` — publish the result.

Run the pipeline with `npm run run:daily`, or let the included GitHub Actions
workflow (`.github/workflows/daily.yml`) check the queue once a day and
publish automatically when there's something in it.

## Prerequisites

```bash
brew install ffmpeg node
```

## Account setup (do this yourself — takes ~30-45 min once)

### 1. OpenAI
Create a key at https://platform.openai.com/api-keys → `OPENAI_API_KEY`.
Used for script writing, TTS, and Whisper timestamps. Costs a few cents per video.

### 2. Pexels (free)
Sign up at https://www.pexels.com/api/ → `PEXELS_API_KEY`. Free tier is
generous (200 req/hour) — plenty for 1 video/day.

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
