import { mkdir } from "node:fs/promises";
import path from "node:path";
import "dotenv/config";
import { generateScript } from "./generateScript.js";
import { synthesizeNarration } from "./tts.js";
import { pickBroll } from "./pickBroll.js";
import { assembleVideo } from "./assemble.js";
import { uploadToYoutube } from "./uploadYoutube.js";
import { uploadToInstagram } from "./uploadInstagram.js";

async function main() {
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = path.resolve(import.meta.dirname, "..", "render", runId);
  await mkdir(outDir, { recursive: true });

  console.log("Generating script...");
  const story = await generateScript();
  console.log(`[${story.category}] ${story.title}`);

  console.log("Synthesizing narration...");
  const narration = await synthesizeNarration(story.script, outDir);
  console.log(`Narration duration: ${narration.durationSeconds.toFixed(1)}s`);

  console.log("Picking b-roll...");
  const brollPath = await pickBroll(story.brollKeywords, outDir, narration.durationSeconds);

  console.log("Assembling video...");
  const videoPath = await assembleVideo({
    brollPath,
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
