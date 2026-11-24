import assert from "node:assert/strict";
import test from "node:test";
import { buildMotionPrompt, parseRenderMode, pickClipDuration } from "./animateScenes.js";
import { buildMotionClipArgs, planSceneTimeline } from "./assemble.js";
import { idempotencyKey } from "./higgsfield.js";

test("pickClipDuration uses the shortest clip that covers the scene", () => {
  assert.equal(pickClipDuration(5.4, [6, 10]), 6);
  assert.equal(pickClipDuration(6.02, [10, 6]), 6);
  assert.equal(pickClipDuration(7.5, [6, 10]), 10);
  assert.equal(pickClipDuration(14, [6, 10]), 10);
});

test("parseRenderMode defaults to ken_burns and rejects typos", () => {
  assert.equal(parseRenderMode(undefined), "ken_burns");
  assert.equal(parseRenderMode(" Higgsfield_Motion "), "higgsfield_motion");
  assert.throws(() => parseRenderMode("higgsfeld"));
});

test("motion prompt keeps the scene and forbids realistic redraws", () => {
  const prompt = buildMotionPrompt("Kit waves at Quack.", "clean 2D stickman cartoon");
  assert.match(prompt, /Kit waves at Quack\./);
  assert.match(prompt, /do not turn them into realistic people/);
  assert.match(prompt, /Style: clean 2D stickman cartoon/);
});

test("idempotency key is stable and input-sensitive", () => {
  assert.equal(idempotencyKey(["a", "1"]), idempotencyKey(["a", "1"]));
  assert.notEqual(idempotencyKey(["a", "1"]), idempotencyKey(["a", "2"]));
  assert.notEqual(idempotencyKey(["a1", ""]), idempotencyKey(["a", "1"]));
});

test("motion clips are trimmed or frozen to the exact scene length", () => {
  const args = buildMotionClipArgs("in.mp4", 5.5, "out.mp4");
  assert.equal(args[args.indexOf("-t") + 1], "5.5");
  assert.ok(args.includes("-an"));
  assert.match(args[args.indexOf("-vf") + 1], /crop=1080:1920,fps=30,tpad=stop_mode=clone/);
});

test("planSceneTimeline scales word timings to the target runtime", () => {
  const words = [
    { word: "a", start: 0, end: 20 },
    { word: "b", start: 20, end: 40 },
  ];
  const plan = planSceneTimeline(words, 40, 2, 36);
  assert.equal(plan.playbackRate, 40 / 36);
  assert.equal(plan.scaledWords[1].end, 36);
  assert.equal(plan.sceneDurations.reduce((sum, d) => sum + d, 0), 36);
});
