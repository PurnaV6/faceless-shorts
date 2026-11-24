import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

interface StickmanConfig {
  totalEpisodes: number;
  sceneCount: number;
  targetDurationSeconds: number;
  episodic: boolean;
  renderMode: string;
  visualStyle: string;
  characters: { id: string; name: string }[];
  episodes: { number: number; title: string; beat: string; finalLine: string; visualSequence: string[] }[];
}

const configPath = path.resolve(import.meta.dirname, "..", "config", "code-crew-stickman.json");
const config = JSON.parse(await readFile(configPath, "utf8")) as StickmanConfig;

test("stickman series is episodic and rendered with Higgsfield motion", () => {
  assert.equal(config.episodic, true);
  assert.equal(config.renderMode, "higgsfield_motion");
  assert.match(config.visualStyle, /stick/);
  // 6 scenes over 36s keeps each scene close to one 6s Higgsfield clip.
  assert.equal(config.targetDurationSeconds / config.sceneCount, 6);
});

test("stickman cast is locked and unique", () => {
  assert.deepEqual(
    config.characters.map((c) => c.name),
    ["Kit", "Mira", "Glitch", "Dana", "Quack"],
  );
  assert.equal(new Set(config.characters.map((c) => c.id)).size, config.characters.length);
});

test("every stickman episode has a full shot list and fixed final line", () => {
  assert.equal(config.episodes.length, config.totalEpisodes);
  config.episodes.forEach((episode, index) => {
    assert.equal(episode.number, index + 1);
    assert.ok(episode.beat.length > 80, `Episode ${episode.number} beat is too vague`);
    assert.equal(episode.visualSequence.length, config.sceneCount);
    assert.ok(episode.finalLine.trim().length > 0);
    // Glued dashes break word-level caption timing.
    assert.doesNotMatch(episode.finalLine, /\S[—–]\S/);
  });
  assert.equal(new Set(config.episodes.map((e) => e.title)).size, config.totalEpisodes);
});
