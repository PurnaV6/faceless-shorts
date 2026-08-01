import { createClient } from "@supabase/supabase-js";
import {
  markQueuedStorylineAwaitingReview,
  markQueuedStorylinePublished,
} from "./queue.js";

export interface ApprovedRender {
  id: string;
  queueId: string;
  title: string;
  displayTitle: string;
  description: string;
  tags: string[];
  videoUrl: string;
  youtubeVideoId: string | null;
  instagramMediaId: string | null;
}

function getClient() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, serviceKey);
}

export async function createReviewRender(params: {
  queueId: string;
  seriesId: string | null;
  episodeNumber: number | null;
  title: string;
  displayTitle: string;
  description: string;
  tags: string[];
  script: string;
  recap: string | null;
  videoUrl: string;
}): Promise<string> {
  const supabase = getClient();
  const { data: existing, error: existingError } = await supabase
    .from("video_renders")
    .select("id")
    .eq("queue_id", params.queueId)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) {
    await markQueuedStorylineAwaitingReview(params.queueId);
    return existing.id;
  }

  const { data, error } = await supabase
    .from("video_renders")
    .insert({
      queue_id: params.queueId,
      series_id: params.seriesId,
      episode_number: params.episodeNumber,
      title: params.title,
      display_title: params.displayTitle,
      description: params.description,
      tags: params.tags,
      script: params.script,
      recap: params.recap,
      video_url: params.videoUrl,
      status: "awaiting_review",
    })
    .select("id")
    .single();
  if (error) throw error;

  await markQueuedStorylineAwaitingReview(params.queueId);
  return data.id;
}

export async function claimNextApprovedRender(): Promise<ApprovedRender | null> {
  const supabase = getClient();
  const { data, error } = await supabase
    .from("video_renders")
    .select(
      "id, queue_id, title, display_title, description, tags, video_url, youtube_video_id, instagram_media_id",
    )
    .eq("status", "approved")
    .order("approved_at", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const { data: claimed, error: claimError } = await supabase
    .from("video_renders")
    .update({ status: "publishing", error_message: null })
    .eq("id", data.id)
    .eq("status", "approved")
    .select("id")
    .maybeSingle();
  if (claimError) throw claimError;
  if (!claimed) return null;

  return {
    id: data.id,
    queueId: data.queue_id,
    title: data.title,
    displayTitle: data.display_title,
    description: data.description,
    tags: (data.tags ?? []) as string[],
    videoUrl: data.video_url,
    youtubeVideoId: data.youtube_video_id,
    instagramMediaId: data.instagram_media_id,
  };
}

export async function savePlatformResult(
  renderId: string,
  platform: "youtube" | "instagram",
  platformId: string,
): Promise<void> {
  const supabase = getClient();
  const column = platform === "youtube" ? "youtube_video_id" : "instagram_media_id";
  const { error } = await supabase.from("video_renders").update({ [column]: platformId }).eq("id", renderId);
  if (error) throw error;
}

export async function markRenderPublished(renderId: string, queueId: string): Promise<void> {
  const supabase = getClient();
  const { error } = await supabase
    .from("video_renders")
    .update({ status: "published", published_at: new Date().toISOString(), error_message: null })
    .eq("id", renderId);
  if (error) throw error;
  await markQueuedStorylinePublished(queueId);
}

export async function markRenderFailed(renderId: string, errorMessage: string): Promise<void> {
  const supabase = getClient();
  const { error } = await supabase
    .from("video_renders")
    .update({ status: "failed", error_message: errorMessage.slice(0, 2000) })
    .eq("id", renderId);
  if (error) throw error;
}
