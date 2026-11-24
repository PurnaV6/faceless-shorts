import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { createSeries } from "./series.js";
import type { CharacterProfile, ContinuityBible, NarratorGender } from "./types.js";

// Queues a checked-in, fully locked series (cast, style, canon and every
// episode beat) without asking a model to invent an outline.
//   npm run queue:priya      -> config/priya-case.json
//   npm run queue:stickman   -> config/code-crew-stickman.json

interface LockedEpisode {
  number: number;
  title: string;
  beat: string;
  // Serialized series end on a question; episodic ones end on a fixed line.
  endQuestion?: string;
  finalLine?: string;
  visualSequence?: string[];
}

interface LockedSeriesConfig extends ContinuityBible {
  seriesTitle: string;
  totalEpisodes: number;
  targetDurationSeconds: number;
  sceneCount: number;
  narratorGender: NarratorGender;
  visualStyle: string;
  characters: CharacterProfile[];
  episodes: LockedEpisode[];
}

const ROOT = path.resolve(import.meta.dirname, "..");
const CONFIG_PATH = path.resolve(ROOT, process.argv[2] ?? path.join("config", "priya-case.json"));

function buildEpisodeSource(config: LockedSeriesConfig, episode: LockedEpisode): string {
  const ending = config.episodic
    ? `EXACT FINAL LINE: ${episode.finalLine}`
    : `EXACT FINAL CLIFFHANGER QUESTION: ${episode.endQuestion}`;
  return [
    `LOCKED TITLE: ${episode.title}`,
    `LOCKED EPISODE BEAT: ${episode.beat}`,
    episode.visualSequence?.length
      ? `LOCKED VISUAL ORDER:\n${episode.visualSequence.map((shot, index) => `${index + 1}. ${shot}`).join("\n")}`
      : "",
    ending,
    config.episodic
      ? "This episode must stay within its locked beat."
      : "This episode must reveal only the information in its locked beat. Do not borrow any later reveal.",
  ]
    .filter(Boolean)
    .join("\n");
}

async function main(): Promise<void> {
  const config = JSON.parse(await readFile(CONFIG_PATH, "utf8")) as LockedSeriesConfig;
  if (config.episodes.length !== config.totalEpisodes) {
    throw new Error(
      `${path.basename(CONFIG_PATH)} has ${config.episodes.length} episodes but totalEpisodes=${config.totalEpisodes}`,
    );
  }
  config.episodes.forEach((episode, index) => {
    if (episode.number !== index + 1) {
      throw new Error(`Expected episode ${index + 1}, found episode ${episode.number}`);
    }
    if (!(config.episodic ? episode.finalLine : episode.endQuestion)) {
      throw new Error(`Episode ${episode.number} needs ${config.episodic ? "finalLine" : "endQuestion"}`);
    }
  });

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  }
  const supabase = createClient(supabaseUrl, supabaseKey);

  const { data: existing, error: existingError } = await supabase
    .from("series")
    .select("id")
    .eq("title", config.seriesTitle)
    .limit(1)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) {
    throw new Error(
      `A series named "${config.seriesTitle}" already exists (${existing.id}). ` +
        "Remove that test series before intentionally queueing a replacement.",
    );
  }

  const characterDescription = config.characters
    .map((character) => `${character.name}: ${character.appearance}`)
    .join(" | ");

  const seriesId = await createSeries({
    title: config.seriesTitle,
    totalEpisodes: config.totalEpisodes,
    visualStyle: config.visualStyle,
    characterDescription,
    characterRoster: config.characters,
    continuityBible: {
      premise: config.premise,
      truth: config.truth,
      revealRules: config.revealRules,
      languageRules: config.languageRules,
      recurringMarkers: config.recurringMarkers,
      ...(config.episodic ? { episodic: true } : {}),
      ...(config.renderMode ? { renderMode: config.renderMode } : {}),
    },
    narratorGender: config.narratorGender,
    targetDurationSeconds: config.targetDurationSeconds,
    sceneCount: config.sceneCount,
  });

  const now = Date.now();
  const rows = config.episodes.map((episode, index) => ({
    storyline: buildEpisodeSource(config, episode),
    status: "pending" as const,
    series_id: seriesId,
    episode_number: episode.number,
    created_at: new Date(now + index * 1000).toISOString(),
  }));

  const { error } = await supabase.from("storyline_queue").insert(rows);
  if (error) throw error;

  console.log(`Created locked series "${config.seriesTitle}" (${seriesId}).`);
  console.log(`Queued ${rows.length} episodes in canonical order.`);
  console.log("Each render will be held for review before either platform can publish it.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
