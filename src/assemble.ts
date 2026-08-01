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

function formatAssTime(seconds: number): string {
  const centiseconds = Math.round(seconds * 100);
  const h = Math.floor(centiseconds / 360_000);
  const m = Math.floor((centiseconds % 360_000) / 6_000);
  const s = Math.floor((centiseconds % 6_000) / 100);
  const cs = centiseconds % 100;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

export function buildSubscribeAss(
  targetDurationSeconds: number,
  text = "SUBSCRIBE",
  visibleSeconds = 3.5,
): string {
  if (!Number.isFinite(targetDurationSeconds) || targetDurationSeconds <= 0) {
    throw new Error("Subscribe CTA target duration must be greater than zero");
  }
  if (!Number.isFinite(visibleSeconds) || visibleSeconds <= 0) {
    throw new Error("SUBSCRIBE_CTA_SECONDS must be greater than zero");
  }

  const start = Math.max(0, targetDurationSeconds - visibleSeconds);
  const safeText = text.replace(/[{}\r\n]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);
  const label = safeText || "SUBSCRIBE";

  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    "PlayResX: 1080",
    "PlayResY: 1920",
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    "Style: Subscribe,DejaVu Sans,58,&H00FFFFFF,&H00FFFFFF,&H001515E6,&H001515E6,-1,0,0,0,100,100,1,0,3,18,0,2,80,80,190,1",
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    `Dialogue: 0,${formatAssTime(start)},${formatAssTime(targetDurationSeconds)},Subscribe,,0,0,0,,{\\fad(180,250)}▶  ${label}`,
    "",
  ].join("\n");
}

// Groups words into caption cues up to maxGroupSize, but breaks early at
// sentence/clause punctuation so a cue never straddles a sentence boundary
// (e.g. "gone. Panic") or sits on screen too long because it happened to
// land on a natural pause (a dash, comma, etc).
const CAPTION_BREAK_PATTERN = /[.,!?;:—–]['"’”]?$/;

export function buildSrt(words: WordTimestamp[], maxGroupSize = 3): string {
  const lines: string[] = [];
  let index = 1;
  let group: WordTimestamp[] = [];

  const flush = () => {
    if (group.length === 0) return;
    const start = group[0].start;
    const end = group[group.length - 1].end;
    // The reference uses compact stacked phrases in the visual centre. One
    // word per line stays readable over faces and avoids an ultra-wide line.
    const text = group.map((w) => w.word).join("\n");
    lines.push(`${index}`, `${formatSrtTime(start)} --> ${formatSrtTime(end)}`, text, "");
    index += 1;
    group = [];
  };

  for (const word of words) {
    group.push(word);
    if (group.length >= maxGroupSize || CAPTION_BREAK_PATTERN.test(word.word)) {
      flush();
    }
  }
  flush();

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
export function computeSceneDurations(
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
  const zoompan = `zoompan=z='min(zoom+0.00025,1.06)':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920:fps=${FPS}`;
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

export function buildAtempoChain(playbackRate: number): string {
  if (!Number.isFinite(playbackRate) || playbackRate <= 0) {
    throw new Error(`Invalid audio playback rate: ${playbackRate}`);
  }

  const filters: string[] = [];
  let remaining = playbackRate;
  while (remaining > 2) {
    filters.push("atempo=2");
    remaining /= 2;
  }
  while (remaining < 0.5) {
    filters.push("atempo=0.5");
    remaining /= 0.5;
  }
  filters.push(`atempo=${remaining.toFixed(6)}`);
  return filters.join(",");
}

function scaleWordTimings(words: WordTimestamp[], scale: number): WordTimestamp[] {
  return words.map((word) => ({
    ...word,
    start: word.start * scale,
    end: word.end * scale,
  }));
}

export async function assembleVideo(params: {
  imagePaths: string[];
  audioPath: string;
  words: WordTimestamp[];
  durationSeconds: number;
  targetDurationSeconds?: number;
  outDir: string;
}): Promise<string> {
  const { imagePaths, audioPath, words, durationSeconds, outDir } = params;
  const targetDurationSeconds = params.targetDurationSeconds ?? durationSeconds;
  if (durationSeconds <= 0 || targetDurationSeconds <= 0) {
    throw new Error("Narration and target durations must both be greater than zero");
  }

  // atempo uses >1 to speed audio up and <1 to slow it down. Word timings
  // must be scaled by the inverse relationship so captions stay locked.
  const playbackRate = durationSeconds / targetDurationSeconds;
  const timingScale = targetDurationSeconds / durationSeconds;
  const scaledWords = scaleWordTimings(words, timingScale);
  const durations = computeSceneDurations(
    scaledWords,
    imagePaths.length,
    targetDurationSeconds,
  );

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
  await writeFile(srtPath, buildSrt(scaledWords));

  const outPath = path.join(outDir, "final.mp4");
  // libass converts SRT through a low-resolution virtual canvas. Alignment 8
  // with this scaled margin lands the stacked phrase around mid-frame across
  // both the macOS ffmpeg-full and Ubuntu builds used by this project.
  const subtitlesArg = `subtitles=${escapeForFfmpegFilter(srtPath)}:force_style='FontName=Arial Black,FontSize=16,Bold=-1,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=3,Shadow=1,Alignment=8,MarginV=80'`;
  const ctaEnabled = !["false", "0", "no"].includes(
    (process.env.SUBSCRIBE_CTA_ENABLED || "true").trim().toLowerCase(),
  );
  const videoFilters = [subtitlesArg];
  if (ctaEnabled) {
    const visibleSeconds = Number(process.env.SUBSCRIBE_CTA_SECONDS || "3.5");
    const subscribePath = path.join(outDir, "subscribe.ass");
    await writeFile(
      subscribePath,
      buildSubscribeAss(
        targetDurationSeconds,
        process.env.SUBSCRIBE_CTA_TEXT || "SUBSCRIBE",
        visibleSeconds,
      ),
    );
    videoFilters.push(`subtitles=${escapeForFfmpegFilter(subscribePath)}`);
  }
  const audioFilters = `${buildAtempoChain(playbackRate)},apad`;

  await run(FFMPEG_BIN, [
    "-y",
    "-i",
    concatPath,
    "-i",
    audioPath,
    "-filter_complex",
    `[0:v]${videoFilters.join(",")}[v];[1:a]${audioFilters}[a]`,
    "-map",
    "[v]",
    "-map",
    "[a]",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-t",
    String(targetDurationSeconds),
    "-movflags",
    "+faststart",
    outPath,
  ]);

  return outPath;
}
