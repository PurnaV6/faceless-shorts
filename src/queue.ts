import { createClient } from "@supabase/supabase-js";

export interface QueuedStoryline {
  id: string;
  storyline: string;
  createdAt: string;
  seriesId: string | null;
  episodeNumber: number | null;
}

function getClient() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, serviceKey);
}

export async function fetchNextQueuedStoryline(): Promise<QueuedStoryline | null> {
  const supabase = getClient();
  const { data, error } = await supabase
    .from("storyline_queue")
    .select("id, storyline, created_at, series_id, episode_number")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return {
    id: data.id,
    storyline: data.storyline,
    createdAt: data.created_at,
    seriesId: data.series_id,
    episodeNumber: data.episode_number,
  };
}

async function updateQueuedStorylineStatus(
  id: string,
  status: "awaiting_review" | "published" | "failed",
): Promise<void> {
  const supabase = getClient();
  const timestamps =
    status === "awaiting_review"
      ? { rendered_at: new Date().toISOString() }
      : status === "published"
        ? { used_at: new Date().toISOString() }
        : {};
  const { error } = await supabase
    .from("storyline_queue")
    .update({ status, ...timestamps })
    .eq("id", id);
  if (error) throw error;
}

export async function markQueuedStorylineAwaitingReview(id: string): Promise<void> {
  await updateQueuedStorylineStatus(id, "awaiting_review");
}

export async function markQueuedStorylinePublished(id: string): Promise<void> {
  await updateQueuedStorylineStatus(id, "published");
}

export async function markQueuedStorylineFailed(id: string): Promise<void> {
  await updateQueuedStorylineStatus(id, "failed");
}
