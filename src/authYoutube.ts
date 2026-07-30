import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { google } from "googleapis";
import open from "open";
import "dotenv/config";

const PORT = 53682;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;
const ENV_PATH = path.resolve(import.meta.dirname, "..", ".env");

async function main() {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "Set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET in .env before running this (from your Google Cloud OAuth client).",
    );
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/youtube.upload"],
  });

  const refreshToken = await new Promise<string>((resolve, reject) => {
    const server = createServer(async (req, res) => {
      if (!req.url?.startsWith("/oauth2callback")) return;
      const code = new URL(req.url, REDIRECT_URI).searchParams.get("code");
      res.end("Authorized. You can close this tab and return to the terminal.");
      server.close();
      if (!code) return reject(new Error("No code returned from Google"));
      const { tokens } = await oauth2Client.getToken(code);
      if (!tokens.refresh_token) {
        return reject(
          new Error(
            "No refresh_token returned. Revoke prior access at https://myaccount.google.com/permissions and re-run.",
          ),
        );
      }
      resolve(tokens.refresh_token);
    });
    server.listen(PORT, () => {
      console.log(`Opening browser for Google OAuth consent...\n${authUrl}`);
      open(authUrl);
    });
  });

  const envContent = await readFile(ENV_PATH, "utf-8").catch(() => "");
  const withoutOldToken = envContent
    .split("\n")
    .filter((line) => !line.startsWith("YOUTUBE_REFRESH_TOKEN="))
    .join("\n");
  await writeFile(
    ENV_PATH,
    `${withoutOldToken.trimEnd()}\nYOUTUBE_REFRESH_TOKEN=${refreshToken}\n`,
  );

  console.log("Saved YOUTUBE_REFRESH_TOKEN to .env. You're ready to upload.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
