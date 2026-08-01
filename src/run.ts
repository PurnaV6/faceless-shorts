import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import "dotenv/config";
import { generateScript } from "./generateScript.js";
import { synthesizeNarration } from "./tts.js";
import { generateSceneImages } from "./generateImages.js";
import { assembleVideo } from "./assemble.js";
import { fetchSeries, lockReferenceImage, uploadReferenceImage, appendToRunningSummary } from "./series.js";
import { uploadVideoToSupabase } from "./storage.js";
import { createReviewRender } from "./reviewQueue.js";
import { recordRenderedStory } from "./state.js";
import { fetchNextQueuedStoryline } from "./queue.js";
import type { StoryScript } from "./types.js";

const SUMMARY_PATH = path.resolve(import.meta.dirname, "..", "episode-summary.json");

interface EpisodeSummaryOutput {
  skipped: boolean;
  title?: string;
  category?: string;
  episodeNumber?: number;
  totalEpisodes?: number;
  recap?: string;
  status?: "awaiting_review";
  previewUrl?: string;
  renderId?: string;
}

async function writeSummary(summary: EpisodeSummaryOutput): Promise<void> {
  await writeFile(SUMMARY_PATH, JSON.stringify(summary, null, 2));
}

async function loadCachedStory(cachePath: string, queueEntryId: string): Promise<StoryScript | null> {
  try {
    const story = JSON.parse(await readFile(cachePath, "utf8")) as StoryScript;
    if (story.queueEntryId !== queueEntryId) {
      throw new Error(`Cached script belongs to queue item ${story.queueEntryId}, not ${queueEntryId}`);
    }
    return story;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function main() {
  console.log("Checking for a queued storyline...");
  const queued = await fetchNextQueuedStoryline();
  if (!queued) {
    console.log("No storyline queued today — skipping this run.");
    await writeSummary({ skipped: true });
    return;
  }

  // A stable folder makes the expensive parts resumable. If a run fails
  // after producing some assets, the retry uses the same script, voice and
  // completed frames instead of purchasing them a second time.
  const outDir = path.resolve(import.meta.dirname, "..", "render", queued.id);
  await mkdir(outDir, { recursive: true });
  const storyCachePath = path.join(outDir, "story.json");
  let story = await loadCachedStory(storyCachePath, queued.id);
  if (story) {
    console.log("Reusing cached story script");
  } else {
    story = await generateScript(queued);
    await writeFile(storyCachePath, JSON.stringify(story, null, 2));
  }

  const episodeTag = story.series
    ? ` (Part ${story.series.episodeNumber}/${story.series.totalEpisodes})`
    : "";
  console.log(`[${story.category}] ${story.title}${episodeTag}`);

  const voiceId =
    story.narratorGender === "female"
      ? process.env.ELEVENLABS_VOICE_ID_FEMALE
      : process.env.ELEVENLABS_VOICE_ID;
  if (!voiceId) {
    throw new Error(
      `Missing ELEVENLABS_VOICE_ID${story.narratorGender === "female" ? "_FEMALE" : ""} for narrator_gender=${story.narratorGender}`,
    );
  }

  console.log(`Synthesizing narration (${story.narratorGender} voice)...`);
  const narration = await synthesizeNarration(story.script, voiceId, outDir);
  console.log(`Narration duration: ${narration.durationSeconds.toFixed(1)}s`);

  let existingReferenceImageUrl: string | undefined;
  if (story.series && story.series.episodeNumber > 1) {
    const series = await fetchSeries(story.series.seriesId);
    if (!series.characterReferenceImageUrl) {
      throw new Error(
        `Series ${series.id} has no locked reference image yet — episode 1 must render successfully first`,
      );
    }
    existingReferenceImageUrl = series.characterReferenceImageUrl;
  }

  console.log(`Generating ${story.scenePrompts.length} scene images...`);
  const images = await generateSceneImages(
    story.scenePrompts,
    story.visualStyle,
    story.characterDescription,
    outDir,
    existingReferenceImageUrl,
  );

  console.log("Assembling video...");
  const videoPath = await assembleVideo({
    imagePaths: images.imagePaths,
    audioPath: narration.audioPath,
    words: narration.words,
    durationSeconds: narration.durationSeconds,
    targetDurationSeconds: story.targetDurationSeconds,
    outDir,
  });
  console.log(`Rendered ${story.targetDurationSeconds.toFixed(1)}s preview: ${videoPath}`);

  if (story.series && story.series.episodeNumber === 1) {
    console.log("Locking series reference image for future episodes...");
    const referenceUrl = await uploadReferenceImage(story.series.seriesId, images.referenceImagePath);
    await lockReferenceImage(story.series.seriesId, referenceUrl);
  }

  if (story.series && story.episodeSummary) {
    await appendToRunningSummary(
      story.series.seriesId,
      `Episode ${story.series.episodeNumber}: ${story.episodeSummary}`,
    );
  }

  const displayTitle = story.series
    ? `${story.title} — Part ${story.series.episodeNumber}/${story.series.totalEpisodes}`
    : story.title;
  const description = [
    displayTitle,
    story.episodeSummary ?? "",
    story.series ? "8:17 — The Priya Case is an original fictional animated crime story." : "",
    story.hashtags.map((h) => `#${h}`).join(" "),
  ]
    .filter(Boolean)
    .join("\n\n");

  console.log("Uploading review preview to Supabase...");
  const previewUrl = await uploadVideoToSupabase(videoPath, "previews");
  const renderId = await createReviewRender({
    queueId: story.queueEntryId,
    seriesId: story.series?.seriesId ?? null,
    episodeNumber: story.series?.episodeNumber ?? null,
    title: story.title,
    displayTitle,
    description,
    tags: story.hashtags,
    script: story.script,
    recap: story.episodeSummary,
    videoUrl: previewUrl,
  });
  await recordRenderedStory(story);

  // Written alongside the video so `npm run publish -- <videoPath>` can
  // upload it later without needing to re-run generation.
  await writeFile(
    path.join(outDir, "publish-info.json"),
    JSON.stringify({ title: displayTitle, description, hashtags: story.hashtags }, null, 2),
  );

  const summary: EpisodeSummaryOutput = {
    skipped: false,
    title: story.title,
    category: story.category,
    episodeNumber: story.series?.episodeNumber,
    totalEpisodes: story.series?.totalEpisodes,
    recap: story.episodeSummary ?? story.script.slice(0, 280),
    status: "awaiting_review",
    previewUrl,
    renderId,
  };

  await writeSummary(summary);
  console.log(`Preview: ${previewUrl}`);
  console.log(`Review id: ${renderId}`);
  console.log("No platform upload was attempted. Approve this render before publish:approved can use it.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
