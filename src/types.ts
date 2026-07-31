export type Category = "crime" | "love" | "fun";
export type NarratorGender = "male" | "female";

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
}

export interface WordTimestamp {
  word: string;
  start: number;
  end: number;
}
