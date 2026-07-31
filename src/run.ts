import { mkdir } from "node:fs/promises";
import path from "node:path";
import "dotenv/config";
import { generateScript, NoStorylineQueuedError } from "./generateScript.js";
import { synthesizeNarration } from "./tts.js";
import { generateSceneImages } from "./generateImages.js";
import { assembleVideo } from "./assemble.js";
import { uploadToYoutube } from "./uploadYoutube.js";
import { uploadToInstagram } from "./uploadInstagram.js";

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
      return;
    }
    throw err;
  }
  console.log(`[${story.category}] ${story.title}`);

  console.log("Synthesizing narration...");
  const narration = await synthesizeNarration(story.script, outDir);
  console.log(`Narration duration: ${narration.durationSeconds.toFixed(1)}s`);

  console.log(`Generating ${story.scenePrompts.length} scene images...`);
  const imagePaths = await generateSceneImages(story.scenePrompts, story.visualStyle, outDir);

  console.log("Assembling video...");
  const videoPath = await assembleVideo({
    imagePaths,
    audioPath: narration.audioPath,
    words: narration.words,
    durationSeconds: narration.durationSeconds,
    outDir,
  });
  console.log(`Rendered: ${videoPath}`);

  const description = `${story.title}\n\n${story.hashtags.map((h) => `#${h}`).join(" ")}`;

  if (process.env.YOUTUBE_REFRESH_TOKEN) {
    console.log("Uploading to YouTube...");
    const videoId = await uploadToYoutube({
      videoPath,
      title: story.title,
      description,
      tags: story.hashtags,
    });
    console.log(`YouTube: https://youtube.com/shorts/${videoId}`);
  } else {
    console.log("Skipping YouTube upload (no YOUTUBE_REFRESH_TOKEN set).");
  }

  if (process.env.IG_ACCESS_TOKEN) {
    console.log("Uploading to Instagram...");
    const igId = await uploadToInstagram({ videoPath, caption: description });
    console.log(`Instagram media id: ${igId}`);
  } else {
    console.log("Skipping Instagram upload (no IG_ACCESS_TOKEN set).");
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
