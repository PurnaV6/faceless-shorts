import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import type { NarratorGender } from "./types.js";

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

export async function createSeries(title: string, totalEpisodes: number): Promise<string> {
  const supabase = getClient();
  const { data, error } = await supabase
    .from("series")
    .insert({ title, total_episodes: totalEpisodes })
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

// Called once, after episode 1 renders — locks the character/style/voice/
// reference image so every later episode reuses them verbatim instead of
// re-inventing.
export async function lockSeriesCharacter(
  seriesId: string,
  params: {
    visualStyle: string;
    characterDescription: string;
    characterReferenceImageUrl: string;
    narratorGender: NarratorGender;
  },
): Promise<void> {
  const supabase = getClient();
  const { error } = await supabase
    .from("series")
    .update({
      visual_style: params.visualStyle,
      character_description: params.characterDescription,
      character_reference_image_url: params.characterReferenceImageUrl,
      narrator_gender: params.narratorGender,
    })
    .eq("id", seriesId);
  if (error) throw error;
}

// Uploads episode 1's reference character image to the same public Supabase
// bucket used for renders, so later episodes can download it as their
// images.edit input.
export async function uploadReferenceImage(seriesId: string, localImagePath: string): Promise<string> {
  const bucket = process.env.SUPABASE_BUCKET;
  if (!bucket) throw new Error("Missing SUPABASE_BUCKET");

  const supabase = getClient();
  const fileName = `series-references/${seriesId}.png`;
  const fileBuffer = await readFile(localImagePath);

  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(fileName, fileBuffer, { contentType: "image/png", upsert: true });
  if (uploadError) throw uploadError;

  const { data } = supabase.storage.from(bucket).getPublicUrl(fileName);
  return data.publicUrl;
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
