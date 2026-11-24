export type Category = "crime" | "love" | "fun";
export type NarratorGender = "male" | "female";

export interface CharacterProfile {
  id: string;
  name: string;
  role: string;
  appearance: string;
  continuityNotes: string[];
}

export interface ContinuityBible {
  premise: string;
  truth: string[];
  revealRules: string[];
  languageRules: string[];
  recurringMarkers: string[];
  // Episodic series are self-contained episodes that end on a punchline,
  // instead of serialized cliffhangers.
  episodic?: boolean;
  // How scenes are put in motion. Omitted means the RENDER_MODE env var
  // decides (default ken_burns).
  renderMode?: "ken_burns" | "higgsfield_motion";
}

export interface SeriesInfo {
  seriesId: string;
  episodeNumber: number;
  totalEpisodes: number;
  isFinalEpisode: boolean;
}

export interface StoryScript {
  id: string;
  category: Category;
  title: string;
  script: string;
  hashtags: string[];
  visualStyle: string;
  characterDescription: string;
  characterRoster: CharacterProfile[];
  narratorGender: NarratorGender;
  scenePrompts: string[];
  targetDurationSeconds: number;
  queueEntryId: string;
  createdAt: string;
  series: SeriesInfo | null;
  // Short internal recap appended to the series running summary after each
  // successful render so the next episode has continuity context.
  episodeSummary: string | null;
  // Set from the series bible; undefined lets RENDER_MODE decide at render.
  renderMode?: "ken_burns" | "higgsfield_motion";
}

export interface WordTimestamp {
  word: string;
  start: number;
  end: number;
}
