import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import OpenAI from "openai";
import type { Category, NarratorGender, StoryScript } from "./types.js";
import { fetchNextQueuedStoryline, markQueuedStorylineUsed } from "./queue.js";
import { fetchSeries } from "./series.js";

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

// Shared writing-quality guardrails: avoids the two concrete defects a real
// test run surfaced — stock AI phrasing, and dash-glued words that break
// word-level caption timing (an em/en dash with no surrounding space reads
// as a single "word" to the timestamp aligner, so its caption card sits on
// screen far too long).
const STYLE_GUARDRAILS =
  "Avoid generic AI-story clichés and stock phrases (e.g. 'sent shivers down her spine', 'little did she " +
  "know', 'the air was thick with', 'rippled through', 'mystery deepened', 'against all odds', 'echoed " +
  "through the streets'). Write specific, concrete, sensory details grounded in this story's actual facts " +
  "(names, times, places, objects) instead of vague atmospheric filler. Never place an em dash or en dash " +
  "directly against a word with no space on either side (write 'gone — police searched', not " +
  "'gone—police searched'); prefer a period or comma over a dash when in doubt.";

interface FreshScriptFields {
  category: Category;
  title: string;
  script: string;
  hashtags: string[];
  visual_style: string;
  character_description: string;
  scene_prompts: string[];
  narrator_gender: NarratorGender;
  episode_summary: string;
}

interface ContinuationScriptFields {
  category: Category;
  title: string;
  script: string;
  hashtags: string[];
  scene_prompts: string[];
  episode_summary: string;
}

// Standalone (non-series) stories: the model invents the character and art
// style fresh from just this one storyline.
async function generateFresh(
  openai: OpenAI,
  storyline: string,
  categorySummaries: string,
  wordsPerStory: { min: number; max: number },
): Promise<FreshScriptFields> {
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
          `seconds by a single narrator. ${STYLE_GUARDRAILS}`,
      },
      {
        role: "user",
        content: [
          `User's storyline idea: "${storyline}"`,
          "Category options (pick the closest fit):",
          categorySummaries,
          `Length: ${wordsPerStory.min}-${wordsPerStory.max} words.`,
          "Return JSON with keys: category (one of the category ids above), title (string, <=60 chars, punchy), " +
            "script (string, the full narration expanding the user's idea into a complete story with a hook), " +
            "hashtags (array of 6-10 strings without # symbol), visual_style (a short phrase describing ONE " +
            "consistent art style for every scene image, e.g. 'moody cinematic 3D animated film style, " +
            "desaturated blue tones, dramatic rim lighting' — this phrase will be prefixed to every scene " +
            "prompt so the video looks visually cohesive), character_description (a specific, detailed physical " +
            "description of the ONE recurring main character who appears in every scene — hair, face shape, " +
            "build, exact outfit/colors — detailed enough that the same character can be redrawn consistently " +
            "across multiple separate images; invented, not a real/identifiable person), scene_prompts (array " +
            "of exactly 5 short vivid visual descriptions, in story order, each depicting the main character in " +
            "one key moment/setting from the script — no text or lettering in the image), narrator_gender " +
            "(\"male\" or \"female\" — whichever voice best fits who is telling/experiencing this story; " +
            "default to \"male\" if genuinely ambiguous), episode_summary (1-2 sentence recap of what happens " +
            "in this episode, written as context notes for writing a sequel).",
        ].join("\n"),
      },
    ],
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned no content for script generation");
  return JSON.parse(content) as FreshScriptFields;
}

// Every series episode (including episode 1): character/style/voice are
// already locked on the series row from queueSeries, so the model only
// writes this episode's script using the running summary + this episode's
// beat — it never invents or re-derives the protagonist.
async function generateContinuation(
  openai: OpenAI,
  storyline: string,
  categorySummaries: string,
  wordsPerStory: { min: number; max: number },
  series: {
    title: string;
    characterDescription: string;
    runningSummary: string;
  },
  episodeNumber: number,
  totalEpisodes: number,
): Promise<ContinuationScriptFields> {
  const isFinal = episodeNumber >= totalEpisodes;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You write one episode of an ongoing serialized short-form narration script for a faceless story " +
          "Short/Reel. Output strict JSON only, no markdown. Keep continuity with what's already happened. " +
          "Fictionalize any real names/people/events — never identify a real person or real news event. The " +
          `script must read aloud in 45-60 seconds by a single narrator. ${STYLE_GUARDRAILS}`,
      },
      {
        role: "user",
        content: [
          `Series: "${series.title}"`,
          `Established main character (appears in every episode): ${series.characterDescription}`,
          series.runningSummary
            ? `What has happened so far:\n${series.runningSummary}`
            : "This is the first episode — nothing has happened yet.",
          `This episode's beat (episode ${episodeNumber} of ${totalEpisodes}): "${storyline}"`,
          isFinal
            ? "This is the FINAL episode — resolve the story with a satisfying ending."
            : "End this episode on a cliffhanger — do not resolve the overall story yet.",
          "Category options (pick the closest fit):",
          categorySummaries,
          `Length: ${wordsPerStory.min}-${wordsPerStory.max} words.`,
          "Return JSON with keys: category (one of the category ids above), title (string, <=60 chars, punchy, " +
            "may reference the episode number), script (string, the full narration for this episode), hashtags " +
            "(array of 6-10 strings without # symbol), scene_prompts (array of exactly 5 short vivid visual " +
            "descriptions, in order, each depicting the established main character in one key moment/setting " +
            "from this episode's script — no text or lettering in the image), episode_summary (1-2 sentence " +
            "recap of what happens in this episode, written as context notes for writing the next episode).",
        ].join("\n"),
      },
    ],
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned no content for script continuation");
  return JSON.parse(content) as ContinuationScriptFields;
}

export async function generateScript(): Promise<StoryScript> {
  const queued = await fetchNextQueuedStoryline();
  if (!queued) throw new NoStorylineQueuedError();

  const topics: TopicsConfig = JSON.parse(await readFile(TOPICS_PATH, "utf-8"));
  const categorySummaries = topics.categories
    .map((c) => `- ${c.id}: ${c.styleNotes}`)
    .join("\n");

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const isSeriesEpisode = queued.seriesId !== null && queued.episodeNumber !== null;

  let storyScript: StoryScript;

  if (!isSeriesEpisode) {
    const parsed = await generateFresh(openai, queued.storyline, categorySummaries, topics.wordsPerStory);
    storyScript = {
      id: randomUUID(),
      category: parsed.category,
      title: parsed.title,
      script: parsed.script,
      hashtags: parsed.hashtags,
      visualStyle: parsed.visual_style,
      characterDescription: parsed.character_description,
      narratorGender: parsed.narrator_gender,
      scenePrompts: parsed.scene_prompts,
      createdAt: new Date().toISOString(),
      series: null,
      episodeSummary: null,
    };
  } else {
    const series = await fetchSeries(queued.seriesId!);
    const episodeNumber = queued.episodeNumber!;

    if (!series.characterDescription || !series.visualStyle || !series.narratorGender) {
      throw new Error(`Series ${series.id} is missing its locked character/style/voice — check createSeries`);
    }

    const parsed = await generateContinuation(
      openai,
      queued.storyline,
      categorySummaries,
      topics.wordsPerStory,
      { title: series.title, characterDescription: series.characterDescription, runningSummary: series.runningSummary },
      episodeNumber,
      series.totalEpisodes,
    );
    storyScript = {
      id: randomUUID(),
      category: parsed.category,
      title: parsed.title,
      script: parsed.script,
      hashtags: parsed.hashtags,
      visualStyle: series.visualStyle,
      characterDescription: series.characterDescription,
      narratorGender: series.narratorGender,
      scenePrompts: parsed.scene_prompts,
      createdAt: new Date().toISOString(),
      series: {
        seriesId: series.id,
        episodeNumber,
        totalEpisodes: series.totalEpisodes,
        isFinalEpisode: episodeNumber >= series.totalEpisodes,
      },
      episodeSummary: parsed.episode_summary,
    };
  }

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
