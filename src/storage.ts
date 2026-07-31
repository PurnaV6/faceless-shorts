import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

function getBucketClient() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.SUPABASE_BUCKET;
  if (!url || !serviceKey || !bucket) {
    throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_BUCKET");
  }
  return { supabase: createClient(url, serviceKey), bucket };
}

// Shared by Instagram's video_url requirement, the series character
// reference image, and pending-review preview uploads — all just need a
// public URL for a local file in the same Supabase bucket.
export async function uploadPublicFile(
  key: string,
  filePath: string,
  contentType: string,
): Promise<string> {
  const { supabase, bucket } = getBucketClient();
  const fileBuffer = await readFile(filePath);

  const { error } = await supabase.storage
    .from(bucket)
    .upload(key, fileBuffer, { contentType, upsert: true });
  if (error) throw error;

  const { data } = supabase.storage.from(bucket).getPublicUrl(key);
  return data.publicUrl;
}

export async function uploadPublicJson(key: string, value: unknown): Promise<string> {
  const { supabase, bucket } = getBucketClient();
  const buffer = Buffer.from(JSON.stringify(value, null, 2));

  const { error } = await supabase.storage
    .from(bucket)
    .upload(key, buffer, { contentType: "application/json", upsert: true });
  if (error) throw error;

  const { data } = supabase.storage.from(bucket).getPublicUrl(key);
  return data.publicUrl;
}
