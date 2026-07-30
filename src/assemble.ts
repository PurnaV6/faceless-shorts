import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { WordTimestamp } from "./types.js";

const run = promisify(execFile);

function formatSrtTime(seconds: number): string {
  const ms = Math.round(seconds * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const msRem = ms % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(msRem).padStart(3, "0")}`;
}

function buildSrt(words: WordTimestamp[], groupSize = 4): string {
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

export async function assembleVideo(params: {
  brollPath: string;
  audioPath: string;
  words: WordTimestamp[];
  durationSeconds: number;
  outDir: string;
}): Promise<string> {
  const { brollPath, audioPath, words, durationSeconds, outDir } = params;

  const srtPath = path.join(outDir, "captions.srt");
  await writeFile(srtPath, buildSrt(words));

  const outPath = path.join(outDir, "final.mp4");
  const subtitlesArg = `subtitles=${escapeForFfmpegFilter(srtPath)}:force_style='FontName=Arial Black,FontSize=20,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=3,Outline=3,Alignment=2,MarginV=140'`;
  const filterComplex = `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,${subtitlesArg}[v]`;

  await run("ffmpeg", [
    "-y",
    "-stream_loop",
    "-1",
    "-i",
    brollPath,
    "-i",
    audioPath,
    "-filter_complex",
    filterComplex,
    "-map",
    "[v]",
    "-map",
    "1:a",
    "-t",
    String(durationSeconds),
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
