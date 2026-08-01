import "dotenv/config";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { uploadToInstagram } from "./uploadInstagram.js";
import { uploadToYoutube } from "./uploadYoutube.js";
import {
  claimNextApprovedRender,
  markRenderFailed,
  markRenderPublished,
  savePlatformResult,
} from "./reviewQueue.js";

async function main(): Promise<void> {
  const youtubeConfigured = Boolean(
    process.env.YOUTUBE_CLIENT_ID &&
      process.env.YOUTUBE_CLIENT_SECRET &&
      process.env.YOUTUBE_REFRESH_TOKEN,
  );
  const instagramConfigured = Boolean(process.env.IG_USER_ID && process.env.IG_ACCESS_TOKEN);
  if (!youtubeConfigured && !instagramConfigured) {
    console.log("No publishing platform is configured; leaving approved renders untouched.");
    return;
  }

  const render = await claimNextApprovedRender();
  if (!render) {
    console.log("No approved render is waiting to publish.");
    return;
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "faceless-publish-"));
  try {
    if (youtubeConfigured && !render.youtubeVideoId) {
      const response = await fetch(render.videoUrl);
      if (!response.ok) {
        throw new Error(`Could not download approved preview: ${response.status}`);
      }
      const videoPath = path.join(tempDir, "approved.mp4");
      await writeFile(videoPath, Buffer.from(await response.arrayBuffer()));
      console.log(`Publishing approved render ${render.id} to YouTube...`);
      const videoId = await uploadToYoutube({
        videoPath,
        title: render.displayTitle,
        description: render.description,
        tags: render.tags,
      });
      await savePlatformResult(render.id, "youtube", videoId);
      render.youtubeVideoId = videoId;
      console.log(`YouTube: https://youtube.com/shorts/${videoId}`);
    }

    if (instagramConfigured && !render.instagramMediaId) {
      console.log(`Publishing approved render ${render.id} to Instagram...`);
      const mediaId = await uploadToInstagram({
        videoUrl: render.videoUrl,
        caption: render.description,
      });
      await savePlatformResult(render.id, "instagram", mediaId);
      render.instagramMediaId = mediaId;
      console.log(`Instagram media id: ${mediaId}`);
    }

    await markRenderPublished(render.id, render.queueId);
    console.log(`Published approved render ${render.id}.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markRenderFailed(render.id, message);
    throw error;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
