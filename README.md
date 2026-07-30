# Faceless Shorts Pipeline

Generates one fictional crime/love/fun story a day, narrates it, lays it over
stock b-roll with burned-in captions, and publishes it to YouTube Shorts and
Instagram Reels.

## What it does

1. `generateScript.ts` — asks OpenAI for a ~45-60s fictional story (category
   rotates crime → love → fun → repeat), avoiding premises already used
   (tracked in `state/used-stories.json`).
2. `tts.ts` — narrates it with OpenAI TTS, then re-transcribes the audio with
   Whisper to get word-level timestamps for caption sync.
3. `pickBroll.ts` — searches Pexels for portrait stock video matching the
   story's mood/keywords.
4. `assemble.ts` — ffmpeg composites b-roll + narration + burned-in captions
   into a 1080x1920 mp4.
5. `uploadYoutube.ts` / `uploadInstagram.ts` — publish the result.

Run the whole thing with `npm run run:daily`, or let the included GitHub
Actions workflow (`.github/workflows/daily.yml`) do it once a day.

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
Used only as temporary public hosting so Instagram's API can fetch the
rendered video by URL (it requires a `video_url`, not a file upload).
1. Create a project at https://supabase.com if you don't have one.
2. Storage → create a public bucket, e.g. `faceless-shorts-renders`.
3. Project Settings → API → copy the URL and the **service_role** key (not
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

## Running

```bash
npm install
cp .env.example .env   # fill in the keys above
npm run auth:youtube   # one-time
npm run run:daily      # generates + renders + uploads one video
```

## Automating daily uploads

Push this repo to GitHub, add every `.env` value as a repository secret
(Settings → Secrets and variables → Actions), and the included workflow
(`.github/workflows/daily.yml`) will run once a day and publish automatically.
It also commits `state/used-stories.json` back so premises don't repeat
across runs.

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
