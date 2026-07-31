import "dotenv/config";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import { createSeries } from "./series.js";

interface EpisodeBreakdown {
  series_title: string;
  episodes: string[];
}

async function breakIntoEpisodes(
  storyline: string,
  episodeCount: number,
  maxAttempts = 3,
): Promise<EpisodeBreakdown> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content:
        "You break a story premise into a serialized short-form video series outline. Output strict JSON " +
        "only, no markdown.",
    },
    {
      role: "user",
      content: [
        `Story premise: "${storyline}"`,
        `Split this into EXACTLY ${episodeCount} episodes — not ${episodeCount - 1}, not ${episodeCount + 1}. ` +
          `Count the items in your "episodes" array before responding and make sure it is exactly ${episodeCount}.`,
        "Each episode beat should describe only what NEW happens in that episode (not a recap of prior " +
          "episodes — that context gets carried forward separately at render time). Build rising tension " +
          "across the episodes, with each of the first N-1 episodes ending on a hook. The final episode must " +
          "resolve the story.",
        `Return JSON with keys: series_title (short, punchy), episodes (array of exactly ${episodeCount} ` +
          "strings, one beat per episode, in order).",
      ].join("\n"),
    },
  ];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages,
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) throw new Error("OpenAI returned no content for episode breakdown");
    const parsed = JSON.parse(content) as EpisodeBreakdown;

    if (parsed.episodes.length === episodeCount) return parsed;

    console.log(
      `Attempt ${attempt}: got ${parsed.episodes.length} episodes instead of ${episodeCount}, retrying...`,
    );
    messages.push(
      { role: "assistant", content },
      {
        role: "user",
        content:
          `That had ${parsed.episodes.length} episodes, not ${episodeCount}. Return the corrected full JSON ` +
          `again with EXACTLY ${episodeCount} episodes in the array.`,
      },
    );
  }

  throw new Error(`Failed to get exactly ${episodeCount} episodes after ${maxAttempts} attempts`);
}

async function main() {
  const storyline = process.argv[2];
  const episodeCount = parseInt(process.argv[3] ?? "15", 10);

  if (!storyline) {
    console.error('Usage: npm run queue:series -- "<overall storyline premise>" [episodeCount]');
    process.exit(1);
  }

  console.log(`Breaking storyline into ${episodeCount} episodes...`);
  const breakdown = await breakIntoEpisodes(storyline, episodeCount);
  console.log(`Series: "${breakdown.series_title}"`);
  breakdown.episodes.forEach((beat, i) => console.log(`  Episode ${i + 1}: ${beat}`));

  const seriesId = await createSeries(breakdown.series_title, episodeCount);
  console.log(`Created series ${seriesId}`);

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(supabaseUrl, supabaseKey);

  const now = Date.now();
  const rows = breakdown.episodes.map((beat, i) => ({
    storyline: beat,
    status: "pending" as const,
    series_id: seriesId,
    episode_number: i + 1,
    // Staggered by 1s per episode so FIFO ordering (created_at asc) is
    // deterministic even though these all get inserted in one statement.
    created_at: new Date(now + i * 1000).toISOString(),
  }));

  const { error } = await supabase.from("storyline_queue").insert(rows);
  if (error) throw error;

  console.log(`Queued ${rows.length} episodes. The daily pipeline will post one per day, in order.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
