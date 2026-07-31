import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { WordTimestamp } from "./types.js";

export interface NarrationResult {
  audioPath: string;
  words: WordTimestamp[];
  durationSeconds: number;
}

interface ElevenLabsAlignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

interface ElevenLabsResponse {
  audio_base64: string;
  alignment: ElevenLabsAlignment;
}

function alignmentToWords(alignment: ElevenLabsAlignment): WordTimestamp[] {
  const words: WordTimestamp[] = [];
  let buffer = "";
  let wordStart: number | null = null;
  let wordEnd = 0;

  for (let i = 0; i < alignment.characters.length; i++) {
    const ch = alignment.characters[i];
    if (ch.trim() === "") {
      if (buffer) {
        words.push({ word: buffer, start: wordStart ?? 0, end: wordEnd });
        buffer = "";
        wordStart = null;
      }
      continue;
    }
    if (wordStart === null) wordStart = alignment.character_start_times_seconds[i];
    wordEnd = alignment.character_end_times_seconds[i];
    buffer += ch;
  }
  if (buffer) words.push({ word: buffer, start: wordStart ?? 0, end: wordEnd });

  return words;
}

export async function synthesizeNarration(
  script: string,
  voiceId: string,
  outDir: string,
): Promise<NarrationResult> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error("Missing ELEVENLABS_API_KEY");
  }

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: script,
        model_id: "eleven_turbo_v2_5",
      }),
    },
  );

  if (!res.ok) {
    throw new Error(`ElevenLabs TTS failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as ElevenLabsResponse;

  const audioPath = path.join(outDir, "narration.mp3");
  await writeFile(audioPath, Buffer.from(data.audio_base64, "base64"));

  const words = alignmentToWords(data.alignment);
  const durationSeconds = words.length ? words[words.length - 1].end : 0;

  return { audioPath, words, durationSeconds };
}
