import assert from "node:assert/strict";
import test from "node:test";
import { buildAtempoChain, buildSrt, computeSceneDurations } from "./assemble.js";

test("buildAtempoChain normalizes a 40-second narration to 45 seconds", () => {
  assert.equal(buildAtempoChain(40 / 45), "atempo=0.888889");
});

test("buildAtempoChain supports rates outside one ffmpeg atempo filter", () => {
  assert.equal(buildAtempoChain(4.5), "atempo=2,atempo=2,atempo=1.125000");
  assert.equal(buildAtempoChain(0.2), "atempo=0.5,atempo=0.5,atempo=0.800000");
});

test("captions contain no more than three words and break at punctuation", () => {
  const srt = buildSrt([
    { word: "Priya", start: 0, end: 0.3 },
    { word: "vanished.", start: 0.31, end: 0.8 },
    { word: "Her", start: 0.9, end: 1.1 },
    { word: "last", start: 1.11, end: 1.3 },
    { word: "call", start: 1.31, end: 1.6 },
  ]);
  assert.match(srt, /Priya\nvanished\./);
  assert.match(srt, /Her\nlast\ncall/);
  assert.doesNotMatch(srt, /vanished\.\nHer/);
});

test("scene durations cover the target timeline", () => {
  const words = Array.from({ length: 8 }, (_, index) => ({
    word: `w${index}`,
    start: index * 5,
    end: (index + 1) * 5,
  }));
  const durations = computeSceneDurations(words, 8, 40);
  assert.equal(durations.length, 8);
  assert.equal(durations.reduce((sum, duration) => sum + duration, 0), 40);
});
