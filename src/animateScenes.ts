import { stat, unlink } from "node:fs/promises";
import path from "node:path";
import {
  HiggsfieldTerminalError,
  downloadTo,
  idempotencyKey,
  readJobRecord,
  submitRequest,
  waitForRequest,
  writeJobRecord,
} from "./higgsfield.js";
import { uploadPublicFile } from "./storage.js";

export type RenderMode = "ken_burns" | "higgsfield_motion";

export function parseRenderMode(raw: string | undefined | null): RenderMode {
  const value = (raw ?? "").trim().toLowerCase();
  if (!value || value === "ken_burns") return "ken_burns";
  if (value === "higgsfield_motion") return "higgsfield_motion";
  throw new Error(`Unknown render mode "${raw}" (use ken_burns or higgsfield_motion)`);
}

interface MotionSettings {
  modelPath: string;
  durations: number[];
  extraInput: Record<string, unknown>;
  fallbackToKenBurns: boolean;
}

function motionSettings(): MotionSettings {
  const durations = (process.env.HIGGSFIELD_VIDEO_DURATIONS || "6,10")
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  if (durations.length === 0) throw new Error("HIGGSFIELD_VIDEO_DURATIONS must list at least one length");

  let extraInput: Record<string, unknown> = {};
  const rawExtra = process.env.HIGGSFIELD_VIDEO_EXTRA_INPUT?.trim();
  if (rawExtra) {
    const parsed = JSON.parse(rawExtra);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("HIGGSFIELD_VIDEO_EXTRA_INPUT must be a JSON object");
    }
    extraInput = parsed as Record<string, unknown>;
  }

  return {
    modelPath:
      process.env.HIGGSFIELD_VIDEO_MODEL?.trim() || "minimax/hailuo-2.3/standard/image-to-video",
    durations,
    extraInput,
    fallbackToKenBurns: !["false", "0", "no"].includes(
      (process.env.HIGGSFIELD_FALLBACK_KEN_BURNS || "true").trim().toLowerCase(),
    ),
  };
}

// Picks the shortest supported clip length that covers the scene, so every
// scene has real motion for its whole run without paying for a longer clip.
// Scenes longer than every option use the longest one and freeze its last
// frame during assembly.
export function pickClipDuration(neededSeconds: number, options: number[]): number {
  const sorted = [...options].sort((a, b) => a - b);
  return sorted.find((option) => option >= neededSeconds - 0.05) ?? sorted[sorted.length - 1];
}

export function buildMotionPrompt(scenePrompt: string, visualStyle: string): string {
  return [
    `Animate this exact frame. ${scenePrompt}`,
    "The stick-figure characters move with bouncy, expressive cartoon timing: clear arm and leg gestures, " +
      "head tilts, blinking dot eyes and small reactions, like a hand-made 2D stickman animation.",
    "Keep every character's design, colour accessory and proportions exactly as in the frame; do not add " +
      "new characters, do not turn them into realistic people.",
    "Gentle, steady camera with at most a slow push-in. No text, no captions, no logos.",
    `Style: ${visualStyle}`,
  ].join(" ");
}

async function isNonEmptyFile(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).size > 0;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

async function animateOne(params: {
  index: number;
  imagePath: string;
  scenePrompt: string;
  visualStyle: string;
  neededSeconds: number;
  outDir: string;
  storageKeyPrefix: string;
  settings: MotionSettings;
}): Promise<string> {
  const { index, imagePath, outDir, settings } = params;
  const clipPath = path.join(outDir, `scene-${index}.motion.mp4`);
  const jobPath = path.join(outDir, `scene-${index}.motion.json`);
  if (await isNonEmptyFile(clipPath)) {
    console.log(`  Reusing cached motion clip ${index + 1}`);
    return clipPath;
  }

  const duration = pickClipDuration(params.neededSeconds, settings.durations);
  const prompt = buildMotionPrompt(params.scenePrompt, params.visualStyle);
  const key = idempotencyKey([
    params.storageKeyPrefix,
    String(index),
    settings.modelPath,
    String(duration),
    prompt,
  ]);

  let job = await readJobRecord(jobPath);
  if (job && job.idempotencyKey !== key) {
    // Prompt, model or duration changed since that job: start a fresh one.
    job = null;
  }
  if (!job) {
    const imageUrl = await uploadPublicFile(
      `${params.storageKeyPrefix}/scene-${index}.png`,
      imagePath,
      "image/png",
    );
    const submitted = await submitRequest(
      settings.modelPath,
      { ...settings.extraInput, prompt, image_url: imageUrl, duration },
      key,
    );
    job = { requestId: submitted.request_id, idempotencyKey: key, modelPath: settings.modelPath };
    await writeJobRecord(jobPath, job);
    console.log(`  Scene ${index + 1}: submitted ${duration}s clip (${job.requestId})`);
  } else {
    console.log(`  Scene ${index + 1}: resuming Higgsfield request ${job.requestId}`);
  }

  const result = await waitForRequest(job.requestId);
  const url = result.video?.url;
  if (!url) throw new Error(`Higgsfield request ${job.requestId} completed without a video url`);
  await downloadTo(url, clipPath);
  console.log(`  Scene ${index + 1}: motion clip ready`);
  return clipPath;
}

// Turns each still into a short animated clip with Higgsfield image-to-video.
// Returns one entry per scene: a clip path, or null when that scene failed
// and should fall back to a Ken Burns pan of its still.
export async function animateScenes(params: {
  imagePaths: string[];
  scenePrompts: string[];
  sceneDurations: number[];
  visualStyle: string;
  outDir: string;
  storageKeyPrefix: string;
}): Promise<(string | null)[]> {
  const settings = motionSettings();
  console.log(`Motion: ${settings.modelPath}, clip lengths ${settings.durations.join("/")}s`);

  // Jobs run in parallel on Higgsfield's side; polling them together keeps a
  // whole episode to roughly the time of its slowest clip.
  const results = await Promise.allSettled(
    params.imagePaths.map((imagePath, index) =>
      animateOne({
        index,
        imagePath,
        scenePrompt: params.scenePrompts[index] ?? "",
        visualStyle: params.visualStyle,
        neededSeconds: params.sceneDurations[index],
        outDir: params.outDir,
        storageKeyPrefix: params.storageKeyPrefix,
        settings,
      }),
    ),
  );

  const clips: (string | null)[] = [];
  for (const [index, result] of results.entries()) {
    if (result.status === "fulfilled") {
      clips.push(result.value);
      continue;
    }
    const err = result.reason as Error;
    // Only a definitive refusal from Higgsfield is safe to fall back on. A
    // network error or timeout leaves the job record in place so the next
    // run resumes the same (already paid) job.
    if (err instanceof HiggsfieldTerminalError && settings.fallbackToKenBurns) {
      console.warn(`  Scene ${index + 1}: ${err.message}; falling back to a Ken Burns pan`);
      await unlink(path.join(params.outDir, `scene-${index}.motion.json`)).catch(() => {});
      clips.push(null);
      continue;
    }
    throw err;
  }
  return clips;
}
