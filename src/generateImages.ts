import { writeFile } from "node:fs/promises";
import path from "node:path";
import OpenAI from "openai";

export async function generateSceneImages(
  scenePrompts: string[],
  visualStyle: string,
  outDir: string,
): Promise<string[]> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const imagePaths: string[] = [];

  for (let i = 0; i < scenePrompts.length; i++) {
    const prompt = [
      visualStyle,
      scenePrompts[i],
      "Vertical 9:16 composition, no text, no lettering, no watermark.",
    ].join(". ");

    const response = await openai.images.generate({
      model: "gpt-image-1",
      prompt,
      size: "1024x1536",
    });

    const image = response.data?.[0];
    if (!image) throw new Error(`No image returned for scene ${i}`);

    const imagePath = path.join(outDir, `scene-${i}.png`);
    if (image.b64_json) {
      await writeFile(imagePath, Buffer.from(image.b64_json, "base64"));
    } else if (image.url) {
      const res = await fetch(image.url);
      await writeFile(imagePath, Buffer.from(await res.arrayBuffer()));
    } else {
      throw new Error(`Image response for scene ${i} had neither b64_json nor url`);
    }

    imagePaths.push(imagePath);
  }

  return imagePaths;
}
