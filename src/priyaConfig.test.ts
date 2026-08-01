import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

interface PriyaConfig {
  seriesTitle: string;
  totalEpisodes: number;
  targetDurationSeconds: number;
  sceneCount: number;
  characters: { id: string; name: string }[];
  revealRules: string[];
  episodes: { number: number; title: string; beat: string; endQuestion: string }[];
}

const configPath = path.resolve(import.meta.dirname, "..", "config", "priya-case.json");
const config = JSON.parse(await readFile(configPath, "utf8")) as PriyaConfig;

test("Priya preset has the locked format and complete episode order", () => {
  assert.equal(config.seriesTitle, "8:17 — The Priya Case");
  assert.equal(config.totalEpisodes, 18);
  assert.equal(config.targetDurationSeconds, 45);
  assert.equal(config.sceneCount, 8);
  assert.equal(config.episodes.length, 18);
  assert.deepEqual(
    config.episodes.map((episode) => episode.number),
    Array.from({ length: 18 }, (_, index) => index + 1),
  );
});

test("Priya preset locks all six recurring characters", () => {
  assert.deepEqual(
    config.characters.map((character) => character.name),
    ["Priya Sharma", "Neil Varma", "Inspector Maya Rao", "Karan Sethi", "Raghav Bedi", "Meera Joshi"],
  );
  assert.equal(new Set(config.characters.map((character) => character.id)).size, 6);
});

test("every episode has one locked beat and exact cliffhanger", () => {
  for (const episode of config.episodes) {
    assert.ok(episode.title.trim().length > 0, `Episode ${episode.number} title is missing`);
    assert.ok(episode.beat.trim().length > 80, `Episode ${episode.number} beat is too vague`);
    assert.match(episode.endQuestion, /\?$/, `Episode ${episode.number} needs a question`);
  }
  assert.equal(new Set(config.episodes.map((episode) => episode.title)).size, 18);
  assert.ok(config.revealRules.length >= 8);
});
