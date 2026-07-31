import { readFile } from "node:fs/promises";
import path from "node:path";
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

// Shared by series references and legacy preview helpers that need a stable
// public object key.
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

// Review videos use unique keys so a previously approved render can never be
// silently replaced by a later run.
export async function uploadVideoToSupabase(
  videoPath: string,
  folder = "previews",
): Promise<string> {
  const { supabase, bucket } = getBucketClient();
  const fileName = `${folder}/${Date.now()}-${path.basename(videoPath)}`;
  const fileBuffer = await readFile(videoPath);
  const { error } = await supabase.storage
    .from(bucket)
    .upload(fileName, fileBuffer, { contentType: "video/mp4", upsert: false });
  if (error) throw error;

  const { data } = supabase.storage.from(bucket).getPublicUrl(fileName);
  return data.publicUrl;
}
