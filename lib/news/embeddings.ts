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

export interface EmbeddingDocument {
  title: string;
  snippet?: string | null;
  body?: string | null;
  source?: string | null;
  severity?: string | null;
  bucket?: string | null;
  players?: string[];
  flair?: string | null;
}

/**
 * Build the text that gets embedded for RAG.
 * Title + caption alone are too thin for accurate semantic search — include
 * matched players, triage signals, and article body when available.
 */
export function embeddingText(doc: EmbeddingDocument): string {
  const parts: string[] = [];
  const title = doc.title?.trim();
  if (title) parts.push(title);

  const snippet = doc.snippet?.trim();
  if (snippet) parts.push(snippet);

  if (doc.players && doc.players.length > 0) {
    parts.push(`Players: ${doc.players.join(", ")}`);
  }
  if (doc.severity) parts.push(`Severity: ${doc.severity}`);
  if (doc.bucket) parts.push(`Priority: ${doc.bucket}`);
  if (doc.source) parts.push(`Source: ${doc.source}`);
  if (doc.flair) parts.push(`Flair: ${doc.flair}`);

  const body = doc.body?.trim();
  if (body) {
    // Avoid repeating the caption if the body starts with it
    const bodyForEmbed =
      snippet && body.toLowerCase().startsWith(snippet.toLowerCase().slice(0, Math.min(snippet.length, 60)))
        ? body.slice(snippet.length).trim()
        : body;
    if (bodyForEmbed) parts.push(bodyForEmbed);
  }

  return parts.join("\n").trim();
}
