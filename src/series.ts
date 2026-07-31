import { createClient } from "@supabase/supabase-js";
import { uploadPublicFile } from "./storage.js";
import type { CharacterProfile, ContinuityBible, NarratorGender } from "./types.js";

export interface Series {
  id: string;
  title: string;
  totalEpisodes: number;
  visualStyle: string | null;
  characterDescription: string | null;
  characterRoster: CharacterProfile[];
  continuityBible: ContinuityBible | null;
  characterReferenceImageUrl: string | null;
  narratorGender: NarratorGender | null;
  targetDurationSeconds: number;
  sceneCount: number;
  runningSummary: string;
}

function getClient() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, serviceKey);
}

// The cast/style/voice/canon are fixed here from the full series premise at
// creation time, rather than letting an individual episode reinvent them.
export async function createSeries(params: {
  title: string;
  totalEpisodes: number;
  visualStyle: string;
  characterDescription: string;
  characterRoster?: CharacterProfile[];
  continuityBible?: ContinuityBible;
  narratorGender: NarratorGender;
  targetDurationSeconds?: number;
  sceneCount?: number;
}): Promise<string> {
  const supabase = getClient();
  const { data, error } = await supabase
    .from("series")
    .insert({
      title: params.title,
      total_episodes: params.totalEpisodes,
      visual_style: params.visualStyle,
      character_description: params.characterDescription,
      character_roster: params.characterRoster ?? [],
      continuity_bible: params.continuityBible ?? null,
      narrator_gender: params.narratorGender,
      target_duration_seconds: params.targetDurationSeconds ?? 45,
      scene_count: params.sceneCount ?? 5,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

export async function fetchSeries(seriesId: string): Promise<Series> {
  const supabase = getClient();
  const { data, error } = await supabase
    .from("series")
    .select(
      "id, title, total_episodes, visual_style, character_description, character_roster, continuity_bible, character_reference_image_url, narrator_gender, target_duration_seconds, scene_count, running_summary",
    )
    .eq("id", seriesId)
    .single();
  if (error) throw error;

  return {
    id: data.id,
    title: data.title,
    totalEpisodes: data.total_episodes,
    visualStyle: data.visual_style,
    characterDescription: data.character_description,
    characterRoster: (data.character_roster ?? []) as CharacterProfile[],
    continuityBible: (data.continuity_bible ?? null) as ContinuityBible | null,
    characterReferenceImageUrl: data.character_reference_image_url,
    narratorGender: data.narrator_gender,
    targetDurationSeconds: data.target_duration_seconds ?? 45,
    sceneCount: data.scene_count ?? 5,
    runningSummary: data.running_summary,
  };
}

// Called once after episode 1 renders to lock the cast reference image.
export async function lockReferenceImage(seriesId: string, characterReferenceImageUrl: string): Promise<void> {
  const supabase = getClient();
  const { error } = await supabase
    .from("series")
    .update({ character_reference_image_url: characterReferenceImageUrl })
    .eq("id", seriesId);
  if (error) throw error;
}

// Uploads episode 1's cast reference image to the same public Supabase
// bucket used for renders, so later episodes can download it as their
// images.edit input.
export async function uploadReferenceImage(seriesId: string, localImagePath: string): Promise<string> {
  return uploadPublicFile(`series-references/${seriesId}.png`, localImagePath, "image/png");
}

export async function appendToRunningSummary(seriesId: string, addition: string): Promise<void> {
  const series = await fetchSeries(seriesId);
  if (series.runningSummary.split("\n").includes(addition)) return;
  const supabase = getClient();
  const updated = series.runningSummary ? `${series.runningSummary}\n${addition}` : addition;
  const { error } = await supabase
    .from("series")
    .update({ running_summary: updated })
    .eq("id", seriesId);
  if (error) throw error;
}
