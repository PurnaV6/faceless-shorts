import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Category, StoryScript } from "./types.js";

interface UsedStoriesState {
  entries: { id: string; category: Category; title: string; createdAt: string }[];
}

const STATE_PATH = path.resolve(import.meta.dirname, "..", "state", "used-stories.json");

export async function recordRenderedStory(story: StoryScript): Promise<void> {
  const state = JSON.parse(await readFile(STATE_PATH, "utf8")) as UsedStoriesState;
  if (state.entries.some((entry) => entry.id === story.id)) return;
  state.entries.push({
    id: story.id,
    category: story.category,
    title: story.title,
    createdAt: story.createdAt,
  });
  await writeFile(STATE_PATH, JSON.stringify(state, null, 2));
}
