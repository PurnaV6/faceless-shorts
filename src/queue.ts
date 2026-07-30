import { createClient } from "@supabase/supabase-js";

export interface QueuedStoryline {
  id: string;
  storyline: string;
  createdAt: string;
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
    .select("id, storyline, created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return { id: data.id, storyline: data.storyline, createdAt: data.created_at };
}

export async function markQueuedStorylineUsed(id: string): Promise<void> {
  const supabase = getClient();
  const { error } = await supabase
    .from("storyline_queue")
    .update({ status: "used", used_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}
