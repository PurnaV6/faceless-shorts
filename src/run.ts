import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import "dotenv/config";
import { generateScript, NoStorylineQueuedError } from "./generateScript.js";
import { synthesizeNarration } from "./tts.js";
import { generateSceneImages } from "./generateImages.js";
import { assembleVideo } from "./assemble.js";
import { uploadToYoutube } from "./uploadYoutube.js";
import { uploadToInstagram } from "./uploadInstagram.js";
import { fetchSeries, lockSeriesCharacter, uploadReferenceImage, appendToRunningSummary } from "./series.js";

const SUMMARY_PATH = path.resolve(import.meta.dirname, "..", "episode-summary.json");

interface EpisodeSummaryOutput {
  skipped: boolean;
  title?: string;
  category?: string;
  episodeNumber?: number;
  totalEpisodes?: number;
  recap?: string;
  youtubeUrl?: string;
  instagramPosted?: boolean;
}

async function writeSummary(summary: EpisodeSummaryOutput): Promise<void> {
  await writeFile(SUMMARY_PATH, JSON.stringify(summary, null, 2));
}

async function main() {
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = path.resolve(import.meta.dirname, "..", "render", runId);

  console.log("Checking for a queued storyline...");
  let story;
  try {
    await mkdir(outDir, { recursive: true });
    story = await generateScript();
  } catch (err) {
    if (err instanceof NoStorylineQueuedError) {
      console.log("No storyline queued today — skipping this run.");
      await writeSummary({ skipped: true });
      return;
    }
    throw err;
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
    outDir,
  });
  console.log(`Rendered: ${videoPath}`);

  if (story.series && story.series.episodeNumber === 1) {
    console.log("Locking series character reference for future episodes...");
    const referenceUrl = await uploadReferenceImage(story.series.seriesId, images.referenceImagePath);
    await lockSeriesCharacter(story.series.seriesId, {
      visualStyle: story.visualStyle,
      characterDescription: story.characterDescription,
      characterReferenceImageUrl: referenceUrl,
      narratorGender: story.narratorGender,
    });
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
  const description = `${displayTitle}\n\n${story.hashtags.map((h) => `#${h}`).join(" ")}`;

  const summary: EpisodeSummaryOutput = {
    skipped: false,
    title: story.title,
    category: story.category,
    episodeNumber: story.series?.episodeNumber,
    totalEpisodes: story.series?.totalEpisodes,
    recap: story.episodeSummary ?? story.script.slice(0, 280),
  };

  if (process.env.YOUTUBE_REFRESH_TOKEN) {
    console.log("Uploading to YouTube...");
    const videoId = await uploadToYoutube({
      videoPath,
      title: displayTitle,
      description,
      tags: story.hashtags,
    });
    console.log(`YouTube: https://youtube.com/shorts/${videoId}`);
    summary.youtubeUrl = `https://youtube.com/shorts/${videoId}`;
  } else {
    console.log("Skipping YouTube upload (no YOUTUBE_REFRESH_TOKEN set).");
  }

  if (process.env.IG_ACCESS_TOKEN) {
    console.log("Uploading to Instagram...");
    const igId = await uploadToInstagram({ videoPath, caption: description });
    console.log(`Instagram media id: ${igId}`);
    summary.instagramPosted = true;
  } else {
    console.log("Skipping Instagram upload (no IG_ACCESS_TOKEN set).");
  }

  await writeSummary(summary);
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
