import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import OpenAI from "openai";
import type { Category, StoryScript } from "./types.js";
import { fetchNextQueuedStoryline, markQueuedStorylineUsed } from "./queue.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const TOPICS_PATH = path.join(ROOT, "config", "topics.json");
const STATE_PATH = path.join(ROOT, "state", "used-stories.json");

export class NoStorylineQueuedError extends Error {
  constructor() {
    super("No pending storyline in the queue");
    this.name = "NoStorylineQueuedError";
  }
}

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

export async function generateScript(): Promise<StoryScript> {
  const queued = await fetchNextQueuedStoryline();
  if (!queued) throw new NoStorylineQueuedError();

  const topics: TopicsConfig = JSON.parse(await readFile(TOPICS_PATH, "utf-8"));
  const categorySummaries = topics.categories
    .map((c) => `- ${c.id}: ${c.styleNotes}`)
    .join("\n");

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You expand a user-supplied storyline idea into a full short-form narration script for a " +
          "faceless story Short/Reel. Output strict JSON only, no markdown. Keep the user's premise and " +
          "intent intact, but fictionalize any real names/people/events the user references — never let the " +
          "final script identify a real person or a real news event. The script must read aloud in 45-60 " +
          "seconds by a single narrator.",
      },
      {
        role: "user",
        content: [
          `User's storyline idea: "${queued.storyline}"`,
          "Category options (pick the closest fit):",
          categorySummaries,
          `Length: ${topics.wordsPerStory.min}-${topics.wordsPerStory.max} words.`,
          "Return JSON with keys: category (one of the category ids above), title (string, <=60 chars, punchy), " +
            "script (string, the full narration expanding the user's idea into a complete story with a hook and " +
            "an ending), hashtags (array of 6-10 strings without # symbol), visual_style (a short phrase " +
            "describing ONE consistent art style for every scene image, e.g. 'moody cinematic digital painting, " +
            "desaturated blue tones, dramatic lighting' — this phrase will be prefixed to every scene prompt so " +
            "the video looks visually cohesive), scene_prompts (array of exactly 5 short vivid visual " +
            "descriptions, in story order, each depicting one key moment/setting from the script — no text or " +
            "lettering in the image, no real people's likenesses).",
        ].join("\n"),
      },
    ],
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned no content for script generation");

  const parsed = JSON.parse(content) as {
    category: Category;
    title: string;
    script: string;
    hashtags: string[];
    visual_style: string;
    scene_prompts: string[];
  };

  const storyScript: StoryScript = {
    id: randomUUID(),
    category: parsed.category,
    title: parsed.title,
    script: parsed.script,
    hashtags: parsed.hashtags,
    visualStyle: parsed.visual_style,
    scenePrompts: parsed.scene_prompts,
    createdAt: new Date().toISOString(),
  };

  const state = await loadState();
  state.entries.push({
    id: storyScript.id,
    category: storyScript.category,
    title: storyScript.title,
    createdAt: storyScript.createdAt,
  });
  await saveState(state);

  await markQueuedStorylineUsed(queued.id);

  return storyScript;
}
