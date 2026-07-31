import { readFile } from "node:fs/promises";
import path from "node:path";
import "dotenv/config";
import { uploadToYoutube } from "./uploadYoutube.js";
import { uploadToInstagram } from "./uploadInstagram.js";

interface PublishInfo {
  title: string;
  description: string;
  hashtags: string[];
}

async function main() {
  const videoPath = process.argv[2];
  if (!videoPath) {
    console.error('Usage: npm run publish -- "<path to final.mp4 from a SKIP_UPLOAD render>"');
    process.exit(1);
  }

  const infoPath = path.join(path.dirname(videoPath), "publish-info.json");
  const info = JSON.parse(await readFile(infoPath, "utf-8")) as PublishInfo;

  console.log(`Publishing: ${info.title}`);

  if (process.env.YOUTUBE_REFRESH_TOKEN) {
    console.log("Uploading to YouTube...");
    const videoId = await uploadToYoutube({
      videoPath,
      title: info.title,
      description: info.description,
      tags: info.hashtags,
    });
    console.log(`YouTube: https://youtube.com/shorts/${videoId}`);
  } else {
    console.log("Skipping YouTube upload (no YOUTUBE_REFRESH_TOKEN set).");
  }

  if (process.env.IG_ACCESS_TOKEN) {
    console.log("Uploading to Instagram...");
    const igId = await uploadToInstagram({ videoPath, caption: info.description });
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
