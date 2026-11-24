import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

// Minimal client for the Higgsfield platform API (https://docs.higgsfield.ai).
// Requests are asynchronous: a POST to a model path returns a request handle,
// and GET /requests/{id}/status is polled until a terminal status.
const BASE_URL = process.env.HIGGSFIELD_BASE_URL?.trim() || "https://api.higgsfield.ai";

export type HiggsfieldStatus =
  | "queued"
  | "in_progress"
  | "completed"
  | "failed"
  | "nsfw"
  | "canceled";

export interface HiggsfieldRequestStatus {
  status: HiggsfieldStatus;
  request_id: string;
  status_url?: string;
  error?: string;
  video?: { url: string };
  images?: { url: string }[];
}

const TERMINAL: ReadonlySet<HiggsfieldStatus> = new Set(["completed", "failed", "nsfw", "canceled"]);

export class HiggsfieldTerminalError extends Error {
  constructor(
    readonly status: HiggsfieldStatus,
    readonly requestId: string,
    detail?: string,
  ) {
    super(`Higgsfield request ${requestId} ended with status "${status}"${detail ? `: ${detail}` : ""}`);
    this.name = "HiggsfieldTerminalError";
  }
}

export function higgsfieldAuthHeader(): string {
  const id = process.env.HF_API_KEY_ID?.trim();
  const secret = process.env.HF_API_KEY_SECRET?.trim();
  if (!id || !secret) {
    throw new Error(
      "Missing HF_API_KEY_ID / HF_API_KEY_SECRET (create a key at https://console.higgsfield.ai)",
    );
  }
  return `Key ${id}:${secret}`;
}

// Stable per scene + input, so resubmitting the same scene after a crash is
// deduplicated server-side instead of starting (and charging) a second job.
export function idempotencyKey(parts: string[]): string {
  return createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 48);
}

export async function submitRequest(
  modelPath: string,
  input: Record<string, unknown>,
  key: string,
): Promise<HiggsfieldRequestStatus> {
  const res = await fetch(`${BASE_URL}/${modelPath.replace(/^\/+/, "")}`, {
    method: "POST",
    headers: {
      Authorization: higgsfieldAuthHeader(),
      "Content-Type": "application/json",
      "Idempotency-Key": key,
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(`Higgsfield submit to ${modelPath} failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as HiggsfieldRequestStatus;
}

export async function getRequestStatus(requestId: string): Promise<HiggsfieldRequestStatus> {
  const res = await fetch(`${BASE_URL}/requests/${encodeURIComponent(requestId)}/status`, {
    headers: { Authorization: higgsfieldAuthHeader() },
  });
  if (!res.ok) {
    throw new Error(`Higgsfield status for ${requestId} failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as HiggsfieldRequestStatus;
}

export async function waitForRequest(
  requestId: string,
  { intervalMs = 5_000, timeoutMs = 20 * 60_000 } = {},
): Promise<HiggsfieldRequestStatus> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let status: HiggsfieldRequestStatus | null = null;
    try {
      status = await getRequestStatus(requestId);
    } catch (err) {
      // A transient network/5xx error while polling must not abandon a job
      // that is already paid for; keep polling until the deadline.
      console.warn(`  poll error for ${requestId}: ${(err as Error).message}`);
    }
    if (status && TERMINAL.has(status.status)) {
      if (status.status !== "completed") {
        throw new HiggsfieldTerminalError(status.status, requestId, status.error);
      }
      return status;
    }
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for Higgsfield request ${requestId}`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

export async function downloadTo(url: string, outPath: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status}`);
  await writeFile(outPath, Buffer.from(await res.arrayBuffer()));
}

// Records the request id next to the render so a re-run resumes polling the
// existing job rather than submitting a new one.
export interface PendingJobRecord {
  requestId: string;
  idempotencyKey: string;
  modelPath: string;
}

export async function readJobRecord(filePath: string): Promise<PendingJobRecord | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as PendingJobRecord;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function writeJobRecord(filePath: string, record: PendingJobRecord): Promise<void> {
  await writeFile(filePath, JSON.stringify(record, null, 2));
}
