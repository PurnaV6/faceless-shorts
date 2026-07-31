import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import OpenAI from "openai";
import type {
  Category,
  CharacterProfile,
  ContinuityBible,
  NarratorGender,
  StoryScript,
} from "./types.js";
import { fetchNextQueuedStoryline } from "./queue.js";
import { fetchSeries } from "./series.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const TOPICS_PATH = path.join(ROOT, "config", "topics.json");

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

// Shared writing-quality guardrails: avoids the two concrete defects a real
// test run surfaced — stock AI phrasing, and dash-glued words that break
// word-level caption timing (an em/en dash with no surrounding space reads
// as a single "word" to the timestamp aligner, so its caption card sits on
// screen far too long).
const STYLE_GUARDRAILS =
  "Avoid generic AI-story clichés and stock phrases (e.g. 'sent shivers down her spine', 'little did she " +
  "know', 'the air was thick with', 'rippled through', 'mystery deepened', 'against all odds', 'echoed " +
  "through the streets'). Never place an em dash or en dash directly against a word with no space on either " +
  "side (write 'gone — police searched', not 'gone—police searched'); prefer a period or comma over a dash " +
  "when in doubt. " +
  "CRITICAL: if the source material below contains specific concrete details — exact times, named objects, " +
  "locations, quoted dialogue, physical evidence — you MUST keep every one of them in the script, close to " +
  "verbatim. Do not paraphrase a specific detail into a vaguer one, and do not invent replacement details " +
  "that weren't given to you. Specific facts are what make a story feel real; generic description is the " +
  "failure mode to avoid. Only invent new details to fill genuine gaps the source didn't cover.";

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
  series: {
    title: string;
    characterDescription: string;
    characterRoster: CharacterProfile[];
    continuityBible: ContinuityBible | null;
    runningSummary: string;
    targetDurationSeconds: number;
    sceneCount: number;
  },
  episodeNumber: number,
  totalEpisodes: number,
): Promise<ContinuationScriptFields> {
  const isFinal = episodeNumber >= totalEpisodes;
  const minWords = Math.round(series.targetDurationSeconds * 2.2);
  const maxWords = Math.round(series.targetDurationSeconds * 2.55);
  const lockedRoster = series.characterRoster.length
    ? series.characterRoster
    : [
        {
          id: "main",
          name: "Main character",
          role: "recurring protagonist",
          appearance: series.characterDescription,
          continuityNotes: [],
        },
      ];
  const roster = lockedRoster
    .map(
      (character) =>
        `- ${character.name} (${character.role}): ${character.appearance}. ` +
        `Continuity: ${character.continuityNotes.join(" ")}`,
    )
    .join("\n");
  const canon = series.continuityBible;

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
          `script must be paced for exactly ${series.targetDurationSeconds} seconds by a single narrator. ` +
          "Treat the supplied full truth as private writer knowledge, never as permission to reveal a later " +
          `twist. The episode beat and reveal rules control what the audience may learn. ${STYLE_GUARDRAILS}`,
      },
      {
        role: "user",
        content: [
          `Series: "${series.title}"`,
          `LOCKED CHARACTER ROSTER (never change faces, ages, clothes, roles, or relationships):\n${roster}`,
          canon ? `PRIVATE SERIES PREMISE: ${canon.premise}` : "",
          canon ? `PRIVATE FULL TRUTH:\n- ${canon.truth.join("\n- ")}` : "",
          canon ? `REVEAL RULES:\n- ${canon.revealRules.join("\n- ")}` : "",
          canon ? `LANGUAGE RULES:\n- ${canon.languageRules.join("\n- ")}` : "",
          canon ? `RECURRING VISUAL MARKERS:\n- ${canon.recurringMarkers.join("\n- ")}` : "",
          series.runningSummary
            ? `What has happened so far:\n${series.runningSummary}`
            : "This is the first episode — nothing has happened yet.",
          `Source material for episode ${episodeNumber} of ${totalEpisodes} — this is what THIS episode ` +
            `must dramatize. Preserve every specific detail in it (per the CRITICAL instruction above): ` +
            `"${storyline}"`,
          isFinal
            ? "This is the FINAL episode — resolve the story with a satisfying ending."
            : "End this episode on a cliffhanger — do not resolve the overall story yet.",
          "Category options (pick the closest fit):",
          categorySummaries,
          `Length: ${minWords}-${maxWords} spoken words. Use short, urgent sentences and no slow introduction.`,
          "Open with a hook that connects to the previous clue, include no more than one short recap sentence, " +
            "then reveal the episode's one major clue. Finish the narration with the EXACT final cliffhanger " +
            "question supplied in the locked episode source. If the source includes a LOCKED VISUAL ORDER, " +
            "follow all of its numbered shots in that exact order.",
          `Return JSON with keys: category (one of the category ids above), title (use the LOCKED TITLE from the ` +
            `episode source), script (the full narration), hashtags (array of 6-10 strings without # symbol), ` +
            `scene_prompts (array of exactly ${series.sceneCount} short vivid shots in chronological order). ` +
            "Each scene prompt must name every visible locked character, repeat their fixed clothing, specify a " +
            "distinct camera composition, and represent a different beat so the video changes visually every " +
            "few seconds. Do not require Neil or any other character in a scene where they do not belong. " +
            "No text, subtitles, lettering, logos, graphic violence, or visible victim's body/corpse. Also return episode_summary " +
            "(1-2 sentences containing only facts revealed by the end of this episode).",
        ]
          .filter(Boolean)
          .join("\n"),
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
    const standaloneCharacter: CharacterProfile = {
      id: "main",
      name: "Main character",
      role: "recurring protagonist",
      appearance: parsed.character_description,
      continuityNotes: [],
    };
    storyScript = {
      id: randomUUID(),
      category: parsed.category,
      title: parsed.title,
      script: parsed.script,
      hashtags: parsed.hashtags,
      visualStyle: parsed.visual_style,
      characterDescription: parsed.character_description,
      characterRoster: [standaloneCharacter],
      narratorGender: parsed.narrator_gender,
      scenePrompts: parsed.scene_prompts,
      targetDurationSeconds: 45,
      queueEntryId: queued.id,
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

    const characterRoster = series.characterRoster.length
      ? series.characterRoster
      : [
          {
            id: "main",
            name: "Main character",
            role: "recurring protagonist",
            appearance: series.characterDescription,
            continuityNotes: [],
          },
        ];
    const priorRunningSummary = series.runningSummary
      .split("\n")
      .filter((line) => {
        const match = line.match(/^Episode (\d+):/);
        return !match || Number(match[1]) < episodeNumber;
      })
      .join("\n");

    const parsed = await generateContinuation(
      openai,
      queued.storyline,
      categorySummaries,
      {
        title: series.title,
        characterDescription: series.characterDescription,
        characterRoster,
        continuityBible: series.continuityBible,
        runningSummary: priorRunningSummary,
        targetDurationSeconds: series.targetDurationSeconds,
        sceneCount: series.sceneCount,
      },
      episodeNumber,
      series.totalEpisodes,
    );
    if (parsed.scene_prompts.length !== series.sceneCount) {
      throw new Error(
        `Script generator returned ${parsed.scene_prompts.length} scene prompts; expected ${series.sceneCount}`,
      );
    }
    const lockedTitle = queued.storyline.match(/^LOCKED TITLE:\s*(.+)$/m)?.[1]?.trim();
    storyScript = {
      id: randomUUID(),
      category: parsed.category,
      title: lockedTitle || parsed.title,
      script: parsed.script,
      hashtags: parsed.hashtags,
      visualStyle: series.visualStyle,
      characterDescription: series.characterDescription,
      characterRoster,
      narratorGender: series.narratorGender,
      scenePrompts: parsed.scene_prompts,
      targetDurationSeconds: series.targetDurationSeconds,
      queueEntryId: queued.id,
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

  return storyScript;
}
