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

interface TimedChar {
  ch: string;
  start: number;
  end: number;
}

// Splits on whitespace, and ALSO on internal em/en dashes even with no
// surrounding space — ElevenLabs can render "word—word" as adjacent
// characters with no space between them, which without this would collapse
// into one oversized caption card that sits on screen far too long.
function alignmentToWords(alignment: ElevenLabsAlignment): WordTimestamp[] {
  const words: WordTimestamp[] = [];
  let buffer: TimedChar[] = [];

  const flushBuffer = () => {
    if (buffer.length === 0) return;
    let sub: TimedChar[] = [];
    const flushSub = () => {
      if (sub.length === 0) return;
      words.push({
        word: sub.map((c) => c.ch).join(""),
        start: sub[0].start,
        end: sub[sub.length - 1].end,
      });
      sub = [];
    };
    for (const c of buffer) {
      sub.push(c);
      if (c.ch === "—" || c.ch === "–") flushSub();
    }
    flushSub();
    buffer = [];
  };

  for (let i = 0; i < alignment.characters.length; i++) {
    const ch = alignment.characters[i];
    if (ch.trim() === "") {
      flushBuffer();
      continue;
    }
    buffer.push({
      ch,
      start: alignment.character_start_times_seconds[i],
      end: alignment.character_end_times_seconds[i],
    });
  }
  flushBuffer();

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
        // eleven_turbo_v2_5 is tuned for low latency, not expressiveness —
        // multilingual_v2 reads dramatic narration with noticeably more
        // natural prosody. Latency doesn't matter here (this isn't a live
        // conversation), so there's no reason to trade quality for speed.
        model_id: "eleven_multilingual_v2",
        voice_settings: {
          // Lower stability = more vocal variation/emotion (default 0.5
          // reads flat for storytelling); style adds expressive emphasis.
          stability: 0.4,
          similarity_boost: 0.8,
          style: 0.35,
          use_speaker_boost: true,
        },
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
