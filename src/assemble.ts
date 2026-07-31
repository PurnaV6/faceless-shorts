import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { WordTimestamp } from "./types.js";

const run = promisify(execFile);

// Homebrew's plain `ffmpeg` formula ships without libass/freetype, so the
// subtitles filter used below is unavailable. Install `ffmpeg-full` and
// point FFMPEG_BIN at it (see README) if you're on macOS with Homebrew.
const FFMPEG_BIN = process.env.FFMPEG_BIN || "ffmpeg";
const FPS = 30;

function formatSrtTime(seconds: number): string {
  const ms = Math.round(seconds * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const msRem = ms % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(msRem).padStart(3, "0")}`;
}

function buildSrt(words: WordTimestamp[], groupSize = 2): string {
  const lines: string[] = [];
  let index = 1;
  for (let i = 0; i < words.length; i += groupSize) {
    const group = words.slice(i, i + groupSize);
    const start = group[0].start;
    const end = group[group.length - 1].end;
    const text = group.map((w) => w.word).join(" ");
    lines.push(`${index}`, `${formatSrtTime(start)} --> ${formatSrtTime(end)}`, text, "");
    index += 1;
  }
  return lines.join("\n");
}

// ffmpeg's subtitles filter treats ':' as an option separator, so paths must
// have it (and the Windows drive-letter form) escaped when passed inline.
function escapeForFfmpegFilter(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/:/g, "\\:");
}

function escapeForConcatList(filePath: string): string {
  return filePath.replace(/'/g, "'\\''");
}

// Splits the narration timeline into `sceneCount` chunks by word count, so
// each scene image stays on screen roughly as long as the words it covers.
function computeSceneDurations(
  words: WordTimestamp[],
  sceneCount: number,
  totalDuration: number,
): number[] {
  if (words.length === 0) {
    return new Array(sceneCount).fill(totalDuration / sceneCount);
  }

  const chunkSize = Math.ceil(words.length / sceneCount);
  const boundaries: number[] = [];
  for (let i = 0; i < sceneCount; i++) {
    const idx = Math.min((i + 1) * chunkSize - 1, words.length - 1);
    boundaries.push(words[idx].end);
  }
  boundaries[boundaries.length - 1] = totalDuration;

  const durations: number[] = [];
  let prev = 0;
  for (const boundary of boundaries) {
    durations.push(Math.max(0.5, boundary - prev));
    prev = boundary;
  }
  return durations;
}

async function buildKenBurnsClip(
  imagePath: string,
  duration: number,
  outPath: string,
): Promise<void> {
  const frames = Math.max(1, Math.round(duration * FPS));
  const zoompan = `zoompan=z='min(zoom+0.0015,1.2)':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920:fps=${FPS}`;
  const vf = `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,${zoompan},setsar=1`;

  await run(FFMPEG_BIN, [
    "-y",
    "-loop",
    "1",
    "-i",
    imagePath,
    "-vf",
    vf,
    "-t",
    String(duration),
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    outPath,
  ]);
}

export async function assembleVideo(params: {
  imagePaths: string[];
  audioPath: string;
  words: WordTimestamp[];
  durationSeconds: number;
  outDir: string;
}): Promise<string> {
  const { imagePaths, audioPath, words, durationSeconds, outDir } = params;
  const durations = computeSceneDurations(words, imagePaths.length, durationSeconds);

  const clipPaths: string[] = [];
  for (let i = 0; i < imagePaths.length; i++) {
    const clipPath = path.join(outDir, `scene-${i}.mp4`);
    await buildKenBurnsClip(imagePaths[i], durations[i], clipPath);
    clipPaths.push(clipPath);
  }

  const concatListPath = path.join(outDir, "concat.txt");
  await writeFile(
    concatListPath,
    clipPaths.map((p) => `file '${escapeForConcatList(p)}'`).join("\n"),
  );
  const concatPath = path.join(outDir, "concat.mp4");
  await run(FFMPEG_BIN, [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    concatListPath,
    "-c",
    "copy",
    concatPath,
  ]);

  const srtPath = path.join(outDir, "captions.srt");
  await writeFile(srtPath, buildSrt(words));

  const outPath = path.join(outDir, "final.mp4");
  const subtitlesArg = `subtitles=${escapeForFfmpegFilter(srtPath)}:force_style='FontName=Arial Black,FontSize=22,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=3,Shadow=1,Alignment=2,MarginV=160'`;

  await run(FFMPEG_BIN, [
    "-y",
    "-i",
    concatPath,
    "-i",
    audioPath,
    "-filter_complex",
    `[0:v]${subtitlesArg}[v]`,
    "-map",
    "[v]",
    "-map",
    "1:a",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    outPath,
  ]);

  return outPath;
}
