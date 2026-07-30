import { createClient } from "@supabase/supabase-js";

const MAX_LENGTH = 600;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { storyline, secret } = req.body ?? {};

  if (!process.env.QUEUE_SECRET || secret !== process.env.QUEUE_SECRET) {
    res.status(401).json({ error: "Invalid passphrase" });
    return;
  }

  if (typeof storyline !== "string" || !storyline.trim()) {
    res.status(400).json({ error: "Storyline is required" });
    return;
  }
  if (storyline.length > MAX_LENGTH) {
    res.status(400).json({ error: `Storyline must be under ${MAX_LENGTH} characters` });
    return;
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { error } = await supabase
    .from("storyline_queue")
    .insert({ storyline: storyline.trim(), status: "pending" });

  if (error) {
    res.status(500).json({ error: "Failed to queue storyline" });
    return;
  }

  res.status(200).json({ ok: true });
}
