import { writeFile } from "node:fs/promises";
import path from "node:path";

interface PexelsVideoFile {
  link: string;
  width: number;
  height: number;
  quality: string;
}

interface PexelsVideo {
  duration: number;
  video_files: PexelsVideoFile[];
}

interface PexelsSearchResponse {
  videos: PexelsVideo[];
}

function pickBestFile(files: PexelsVideoFile[]): PexelsVideoFile | undefined {
  const portrait = files.filter((f) => f.height > f.width);
  const pool = portrait.length ? portrait : files;
  return [...pool].sort((a, b) => b.height - a.height)[0];
}

export async function pickBroll(
  keywords: string[],
  outDir: string,
  minDurationSeconds: number,
): Promise<string> {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) throw new Error("PEXELS_API_KEY is not set");

  for (const keyword of keywords) {
    const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(
      keyword,
    )}&orientation=portrait&per_page=15`;
    const res = await fetch(url, { headers: { Authorization: apiKey } });
    if (!res.ok) continue;

    const data = (await res.json()) as PexelsSearchResponse;
    const candidates = data.videos.filter((v) => v.duration >= minDurationSeconds);
    if (!candidates.length) continue;

    const chosen = candidates[Math.floor(Math.random() * candidates.length)];
    const file = pickBestFile(chosen.video_files);
    if (!file) continue;

    const videoRes = await fetch(file.link);
    const brollPath = path.join(outDir, "broll.mp4");
    await writeFile(brollPath, Buffer.from(await videoRes.arrayBuffer()));
    return brollPath;
  }

  throw new Error(`No suitable b-roll found for keywords: ${keywords.join(", ")}`);
}
