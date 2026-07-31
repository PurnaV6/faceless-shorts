import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import "dotenv/config";
import { uploadToYoutube } from "./uploadYoutube.js";
import { uploadToInstagram } from "./uploadInstagram.js";

interface PublishInfo {
  title: string;
  description: string;
  hashtags: string[];
}

async function resolveVideoAndInfo(source: string): Promise<{ videoPath: string; info: PublishInfo }> {
  if (!source.startsWith("http://") && !source.startsWith("https://")) {
    const infoPath = path.join(path.dirname(source), "publish-info.json");
    const info = JSON.parse(await readFile(infoPath, "utf-8")) as PublishInfo;
    return { videoPath: source, info };
  }

  // Preview URLs from a SKIP_UPLOAD render: <key>.mp4 with a sibling
  // <key>.json holding the same metadata publish-info.json would have.
  const infoUrl = source.replace(/\.mp4($|\?)/, ".json$1");
  const [videoRes, infoRes] = await Promise.all([fetch(source), fetch(infoUrl)]);
  if (!videoRes.ok) throw new Error(`Failed to download video: ${videoRes.status}`);
  if (!infoRes.ok) throw new Error(`Failed to download publish info: ${infoRes.status}`);

  const dir = await mkdtemp(path.join(tmpdir(), "publish-"));
  const videoPath = path.join(dir, "video.mp4");
  await writeFile(videoPath, Buffer.from(await videoRes.arrayBuffer()));
  const info = (await infoRes.json()) as PublishInfo;

  return { videoPath, info };
}

async function main() {
  const source = process.argv[2];
  if (!source) {
    console.error(
      'Usage: npm run publish -- "<local final.mp4 path, or a pending-review preview URL>"',
    );
    process.exit(1);
  }

  const { videoPath, info } = await resolveVideoAndInfo(source);
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
