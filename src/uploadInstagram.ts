import { uploadVideoToSupabase } from "./storage.js";

const GRAPH_VERSION = "v19.0";

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function graphRequest(pathSegment: string, params: Record<string, string>) {
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${pathSegment}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const res = await fetch(url, { method: "POST" });
  const json = await res.json();
  if (!res.ok) throw new Error(`Instagram Graph API error: ${JSON.stringify(json)}`);
  return json;
}

async function graphGet(pathSegment: string, params: Record<string, string>) {
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${pathSegment}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const res = await fetch(url);
  const json = await res.json();
  if (!res.ok) throw new Error(`Instagram Graph API error: ${JSON.stringify(json)}`);
  return json;
}

export async function uploadToInstagram(params: {
  videoPath?: string;
  videoUrl?: string;
  caption: string;
}): Promise<string> {
  const igUserId = process.env.IG_USER_ID;
  const accessToken = process.env.IG_ACCESS_TOKEN;
  if (!igUserId || !accessToken) {
    throw new Error("Missing IG_USER_ID / IG_ACCESS_TOKEN");
  }

  const videoUrl =
    params.videoUrl ??
    (params.videoPath ? await uploadVideoToSupabase(params.videoPath, "instagram") : null);
  if (!videoUrl) throw new Error("Instagram upload requires videoPath or videoUrl");

  const creation = await graphRequest(`${igUserId}/media`, {
    media_type: "REELS",
    video_url: videoUrl,
    caption: params.caption,
    access_token: accessToken,
  });
  const creationId: string = creation.id;

  for (let attempt = 0; attempt < 30; attempt++) {
    const status = await graphGet(creationId, { fields: "status_code", access_token: accessToken });
    if (status.status_code === "FINISHED") break;
    if (status.status_code === "ERROR") {
      throw new Error(`Instagram failed to process the video: ${JSON.stringify(status)}`);
    }
    await sleep(5000);
  }

  const publish = await graphRequest(`${igUserId}/media_publish`, {
    creation_id: creationId,
    access_token: accessToken,
  });

  return publish.id;
}
