import { createReadStream } from "node:fs";
import { google } from "googleapis";

export async function uploadToYoutube(params: {
  videoPath: string;
  title: string;
  description: string;
  tags: string[];
}): Promise<string> {
  const { videoPath, title, description, tags } = params;

  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  const refreshToken = process.env.YOUTUBE_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "Missing YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET / YOUTUBE_REFRESH_TOKEN. Run `npm run auth:youtube` first.",
    );
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  const youtube = google.youtube({ version: "v3", auth: oauth2Client });
  const requestedPrivacy = process.env.YOUTUBE_PRIVACY_STATUS ?? "public";
  if (!["private", "unlisted", "public"].includes(requestedPrivacy)) {
    throw new Error("YOUTUBE_PRIVACY_STATUS must be private, unlisted, or public");
  }

  const res = await youtube.videos.insert({
    part: ["snippet", "status"],
    requestBody: {
      snippet: {
        title: title.length > 100 ? title.slice(0, 97) + "..." : title,
        description: `${description}\n\n#Shorts`,
        tags,
        categoryId: "24", // Entertainment
      },
      status: {
        privacyStatus: requestedPrivacy,
        selfDeclaredMadeForKids: false,
      },
    },
    media: {
      body: createReadStream(videoPath),
    },
  });

  const videoId = res.data.id;
  if (!videoId) throw new Error("YouTube upload succeeded but returned no video id");
  return videoId;
}
