export type Category = "crime" | "love" | "fun";
export type NarratorGender = "male" | "female";

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
  narratorGender: NarratorGender;
  scenePrompts: string[];
  createdAt: string;
  series: SeriesInfo | null;
  // Only set for series episode 1 — a short recap line to seed the series'
  // running_summary so episode 2 has continuity context to build on.
  episodeSummary: string | null;
}

export interface WordTimestamp {
  word: string;
  start: number;
  end: number;
}
