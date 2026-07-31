import { createClient } from "@supabase/supabase-js";
import type { NarratorGender } from "./types.js";
import { uploadPublicFile } from "./storage.js";

export interface Series {
  id: string;
  title: string;
  totalEpisodes: number;
  visualStyle: string | null;
  characterDescription: string | null;
  characterReferenceImageUrl: string | null;
  narratorGender: NarratorGender | null;
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

// The protagonist/style/voice are fixed here, from the FULL series premise,
// at creation time — not left for episode 1 to invent from just its own
// beat, which in practice tends to lock onto whichever character that one
// beat happens to center on (e.g. a victim who disappears in episode 1)
// rather than the actual through-line protagonist.
export async function createSeries(params: {
  title: string;
  totalEpisodes: number;
  visualStyle: string;
  characterDescription: string;
  narratorGender: NarratorGender;
}): Promise<string> {
  const supabase = getClient();
  const { data, error } = await supabase
    .from("series")
    .insert({
      title: params.title,
      total_episodes: params.totalEpisodes,
      visual_style: params.visualStyle,
      character_description: params.characterDescription,
      narrator_gender: params.narratorGender,
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
      "id, title, total_episodes, visual_style, character_description, character_reference_image_url, narrator_gender, running_summary",
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
    characterReferenceImageUrl: data.character_reference_image_url,
    narratorGender: data.narrator_gender,
    runningSummary: data.running_summary,
  };
}

// Called once, after episode 1 renders — locks in the actual reference
// image (character/style/voice are already fixed from createSeries).
export async function lockReferenceImage(seriesId: string, characterReferenceImageUrl: string): Promise<void> {
  const supabase = getClient();
  const { error } = await supabase
    .from("series")
    .update({ character_reference_image_url: characterReferenceImageUrl })
    .eq("id", seriesId);
  if (error) throw error;
}

// Uploads episode 1's reference character image to the same public Supabase
// bucket used for renders, so later episodes can download it as their
// images.edit input.
export async function uploadReferenceImage(seriesId: string, localImagePath: string): Promise<string> {
  return uploadPublicFile(`series-references/${seriesId}.png`, localImagePath, "image/png");
}

export async function appendToRunningSummary(seriesId: string, addition: string): Promise<void> {
  const series = await fetchSeries(seriesId);
  const supabase = getClient();
  const updated = series.runningSummary ? `${series.runningSummary}\n${addition}` : addition;
  const { error } = await supabase
    .from("series")
    .update({ running_summary: updated })
    .eq("id", seriesId);
  if (error) throw error;
}
