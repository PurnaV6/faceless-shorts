import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import OpenAI from "openai";
import type { Category, StoryScript } from "./types.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const TOPICS_PATH = path.join(ROOT, "config", "topics.json");
const STATE_PATH = path.join(ROOT, "state", "used-stories.json");

interface TopicsConfig {
  categories: { id: Category; label: string; styleNotes: string }[];
  wordsPerStory: { min: number; max: number };
}

interface UsedStoriesState {
  entries: { id: string; category: Category; title: string; createdAt: string }[];
}

async function loadState(): Promise<UsedStoriesState> {
  const raw = await readFile(STATE_PATH, "utf-8");
  return JSON.parse(raw);
}

async function saveState(state: UsedStoriesState): Promise<void> {
  await writeFile(STATE_PATH, JSON.stringify(state, null, 2));
}

function pickCategory(topics: TopicsConfig, usedCount: number): Category {
  return topics.categories[usedCount % topics.categories.length].id;
}

export async function generateScript(): Promise<StoryScript> {
  const topics: TopicsConfig = JSON.parse(await readFile(TOPICS_PATH, "utf-8"));
  const state = await loadState();

  const category = pickCategory(topics, state.entries.length);
  const categoryConfig = topics.categories.find((c) => c.id === category)!;
  const recentTitles = state.entries
    .filter((e) => e.category === category)
    .slice(-15)
    .map((e) => e.title);

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You write short-form narration scripts for faceless story Shorts/Reels. " +
          "Output strict JSON only, no markdown. All characters, names, and events must be fictional — " +
          "never reference real people, real crimes, or real news events, even loosely. " +
          "The script must be written to be read aloud by a single narrator in 45-60 seconds.",
      },
      {
        role: "user",
        content: [
          `Category: ${categoryConfig.label}`,
          `Style notes: ${categoryConfig.styleNotes}`,
          `Length: ${topics.wordsPerStory.min}-${topics.wordsPerStory.max} words.`,
          recentTitles.length
            ? `Do not repeat these previously used premises: ${recentTitles.join("; ")}`
            : "",
          "Return JSON with keys: title (string, <=60 chars, punchy), script (string, the full narration), " +
            "hashtags (array of 6-10 strings without # symbol), broll_keywords (array of 3-5 short search terms " +
            "for stock background video footage that visually fits the mood of this story, e.g. 'rain city street at night').",
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ],
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned no content for script generation");

  const parsed = JSON.parse(content) as {
    title: string;
    script: string;
    hashtags: string[];
    broll_keywords: string[];
  };

  const storyScript: StoryScript = {
    id: randomUUID(),
    category,
    title: parsed.title,
    script: parsed.script,
    hashtags: parsed.hashtags,
    brollKeywords: parsed.broll_keywords,
    createdAt: new Date().toISOString(),
  };

  state.entries.push({
    id: storyScript.id,
    category: storyScript.category,
    title: storyScript.title,
    createdAt: storyScript.createdAt,
  });
  await saveState(state);

  return storyScript;
}
