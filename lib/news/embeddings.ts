/**
 * Server-only. Embeds text using the OpenAI embeddings API (text-embedding-3-small).
 * Uses OPENAI_API_KEY from server env — never exposed to the client.
 * Falls back gracefully (returns null) if the key is absent or the call fails.
 */

const EMBED_MODEL = "text-embedding-3-small";
const EMBED_DIMS = 1536;
const OPENAI_BASE = "https://api.openai.com/v1";

export { EMBED_DIMS };

export async function embedText(text: string): Promise<number[] | null> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;

  const input = text.replace(/\s+/g, " ").trim().slice(0, 8_000);
  if (!input) return null;

  try {
    const res = await fetch(`${OPENAI_BASE}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model: EMBED_MODEL, input }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => res.statusText);
      console.warn(`[embedText] OpenAI ${res.status}: ${err}`);
      return null;
    }
    const data = (await res.json()) as { data: { embedding: number[] }[] };
    return data.data[0]?.embedding ?? null;
  } catch (err) {
    console.warn("[embedText] failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

export function embeddingText(title: string, snippet: string): string {
  return `${title}\n${snippet}`.trim();
}
