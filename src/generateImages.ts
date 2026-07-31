import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import OpenAI, { toFile } from "openai";

const SIZE = "1024x1536" as const;

export interface SceneImagesResult {
  imagePaths: string[];
  // Local path to the canonical character reference image for this render.
  // Callers only need to persist this (for series continuity) on episode 1.
  referenceImagePath: string;
}

async function generateReferenceImage(
  openai: OpenAI,
  visualStyle: string,
  characterDescription: string,
  firstScenePrompt: string,
  outPath: string,
): Promise<void> {
  const prompt = [
    visualStyle,
    `Main character: ${characterDescription}`,
    `Scene: ${firstScenePrompt}`,
    "Vertical 9:16 composition, no text, no lettering, no watermark.",
  ].join(". ");

  const response = await openai.images.generate({
    model: "gpt-image-1",
    prompt,
    size: SIZE,
  });

  const image = response.data?.[0];
  if (!image?.b64_json) throw new Error("No image returned for reference scene");
  await writeFile(outPath, Buffer.from(image.b64_json, "base64"));
}

// Generates one scene by editing the reference image, so the same character
// (face/hair/build/outfit) recurs instead of drifting to a new-looking
// person each time. Always edits from the single canonical reference image,
// never chains edit -> edit -> edit, to avoid compounding drift.
async function generateEditedScene(
  openai: OpenAI,
  referenceImagePath: string,
  visualStyle: string,
  characterDescription: string,
  scenePrompt: string,
  outPath: string,
): Promise<void> {
  const prompt = [
    `Keep the exact same character's face, hair, build, and outfit as shown in the reference image: ${characterDescription}`,
    visualStyle,
    `New scene: ${scenePrompt}`,
    "Vertical 9:16 composition, no text, no lettering, no watermark.",
  ].join(". ");

  const imageFile = await toFile(
    await readFile(referenceImagePath),
    path.basename(referenceImagePath),
    { type: "image/png" },
  );

  const response = await openai.images.edit({
    model: "gpt-image-1",
    image: imageFile,
    prompt,
    size: SIZE,
  });

  const image = response.data?.[0];
  if (!image?.b64_json) throw new Error(`No image returned for scene edit: ${scenePrompt}`);
  await writeFile(outPath, Buffer.from(image.b64_json, "base64"));
}

export async function generateSceneImages(
  scenePrompts: string[],
  visualStyle: string,
  characterDescription: string,
  outDir: string,
  existingReferenceImageUrl?: string,
): Promise<SceneImagesResult> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  if (existingReferenceImageUrl) {
    // Later series episodes: every scene, including the first, is a fresh
    // moment that must still match the locked character from episode 1.
    const referencePath = path.join(outDir, "series-reference.png");
    const res = await fetch(existingReferenceImageUrl);
    if (!res.ok) throw new Error(`Failed to download series reference image: ${res.status}`);
    await writeFile(referencePath, Buffer.from(await res.arrayBuffer()));

    const imagePaths: string[] = [];
    for (let i = 0; i < scenePrompts.length; i++) {
      const imagePath = path.join(outDir, `scene-${i}.png`);
      await generateEditedScene(
        openai,
        referencePath,
        visualStyle,
        characterDescription,
        scenePrompts[i],
        imagePath,
      );
      imagePaths.push(imagePath);
    }
    return { imagePaths, referenceImagePath: referencePath };
  }

  // Standalone story, or episode 1 of a series: invent the character fresh.
  const imagePaths: string[] = [];
  const referencePath = path.join(outDir, "scene-0.png");
  await generateReferenceImage(
    openai,
    visualStyle,
    characterDescription,
    scenePrompts[0],
    referencePath,
  );
  imagePaths.push(referencePath);

  for (let i = 1; i < scenePrompts.length; i++) {
    const imagePath = path.join(outDir, `scene-${i}.png`);
    await generateEditedScene(
      openai,
      referencePath,
      visualStyle,
      characterDescription,
      scenePrompts[i],
      imagePath,
    );
    imagePaths.push(imagePath);
  }

  return { imagePaths, referenceImagePath: referencePath };
}
