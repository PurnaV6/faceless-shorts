import "dotenv/config";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import { createSeries } from "./series.js";
import type { NarratorGender } from "./types.js";

interface EpisodeBreakdown {
  series_title: string;
  protagonist_name: string;
  character_description: string;
  visual_style: string;
  narrator_gender: NarratorGender;
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
        "First, identify the ONE character whose journey we follow across the ENTIRE series — the " +
          "through-line protagonist, not a character who disappears, dies, or exits early (e.g. in a mystery " +
          "where someone goes missing, the protagonist is the person investigating/accused/searching, not the " +
          "missing person). This character must physically appear in every single episode.",
        `Split the premise into EXACTLY ${episodeCount} episodes — not ${episodeCount - 1}, not ` +
          `${episodeCount + 1}. Count the items in your "episodes" array before responding.`,
        "Each episode beat should describe only what NEW happens in that episode (not a recap of prior " +
          "episodes — that context gets carried forward separately at render time), and should be specific " +
          "and concrete (named details, places, objects — not vague summary). Build rising tension across the " +
          "episodes, with each of the first N-1 episodes ending on a hook. The final episode must resolve the " +
          "story.",
        "Return JSON with keys: series_title (short, punchy), protagonist_name (the through-line character's " +
          "name), character_description (specific, detailed physical description of the protagonist — hair, " +
          "face shape, build, exact outfit/colors — detailed enough to redraw consistently across many " +
          "separate images; invented/fictionalized appearance even if the premise names a real-sounding " +
          "person), visual_style (a short phrase for ONE consistent art style across every scene image, e.g. " +
          "'moody cinematic 3D animated film style, desaturated blue tones, dramatic rim lighting'), " +
          "narrator_gender (\"male\" or \"female\", matching the protagonist), " +
          `episodes (array of exactly ${episodeCount} strings, one beat per episode, in order).`,
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
  console.log(`Protagonist: ${breakdown.protagonist_name} (${breakdown.narrator_gender} narrator)`);
  console.log(`Character: ${breakdown.character_description}`);
  console.log(`Visual style: ${breakdown.visual_style}`);
  breakdown.episodes.forEach((beat, i) => console.log(`  Episode ${i + 1}: ${beat}`));

  const seriesId = await createSeries({
    title: breakdown.series_title,
    totalEpisodes: episodeCount,
    visualStyle: breakdown.visual_style,
    characterDescription: breakdown.character_description,
    narratorGender: breakdown.narrator_gender,
  });
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
