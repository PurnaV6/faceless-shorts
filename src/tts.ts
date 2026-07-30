import { createReadStream } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import OpenAI from "openai";
import type { WordTimestamp } from "./types.js";

export interface NarrationResult {
  audioPath: string;
  words: WordTimestamp[];
  durationSeconds: number;
}

const VOICE = "onyx";

export async function synthesizeNarration(
  script: string,
  outDir: string,
): Promise<NarrationResult> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const speech = await openai.audio.speech.create({
    model: "tts-1",
    voice: VOICE,
    input: script,
  });
  const audioPath = path.join(outDir, "narration.mp3");
  await writeFile(audioPath, Buffer.from(await speech.arrayBuffer()));

  const transcription = await openai.audio.transcriptions.create({
    file: createReadStream(audioPath),
    model: "whisper-1",
    response_format: "verbose_json",
    timestamp_granularities: ["word"],
  });

  const words: WordTimestamp[] = (transcription as unknown as {
    words?: { word: string; start: number; end: number }[];
  }).words?.map((w) => ({ word: w.word, start: w.start, end: w.end })) ?? [];

  const durationSeconds = words.length ? words[words.length - 1].end : 0;

  return { audioPath, words, durationSeconds };
}
