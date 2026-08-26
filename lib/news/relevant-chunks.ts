/**
 * Pick short, high-signal passages from article body / snippet text
 * for digests and LLM context (player names + fantasy news keywords).
 */

const KEYWORD_HINTS = [
  "injury",
  "injured",
  "ruled out",
  "out for",
  "inactive",
  "doubtful",
  "questionable",
  "limited",
  "did not practice",
  "dnp",
  "injured reserve",
  "surgery",
  "sprain",
  "fracture",
  "concussion",
  "traded",
  "trade for",
  "acquired",
  "sent to",
  "deal for",
  "in a trade",
  "career high",
  "career-high",
  "monster game",
  "breakout",
  "touchdowns",
  "fantasy points",
  "standout",
  "sleeper",
  "bust",
  "busted",
  "dud",
  "disappointing",
  "worst game",
  "season low",
  "career low",
  "goose egg",
  "zero points",
  "waivers",
  "waiver",
  "start",
  "sit",
];

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Split body into paragraph / sentence-ish chunks suitable for ranking. */
export function splitBodyIntoChunks(text: string, targetSize = 280): string[] {
  const cleaned = text.replace(/\r\n/g, "\n").trim();
  if (!cleaned) return [];

  const paragraphs = cleaned
    .split(/\n{2,}|\n/)
    .map(normalizeWhitespace)
    .filter((p) => p.length >= 40);

  const chunks: string[] = [];
  for (const para of paragraphs.length > 0 ? paragraphs : [normalizeWhitespace(cleaned)]) {
    if (para.length <= targetSize * 1.4) {
      chunks.push(para);
      continue;
    }
    const sentences = para.split(/(?<=[.!?])\s+/);
    let buf = "";
    for (const sentence of sentences) {
      const next = buf ? `${buf} ${sentence}` : sentence;
      if (next.length > targetSize && buf) {
        chunks.push(buf);
        buf = sentence;
      } else {
        buf = next;
      }
    }
    if (buf) chunks.push(buf);
  }

  return chunks;
}

export function scoreChunk(chunk: string, playerNames: string[] = []): number {
  const lower = chunk.toLowerCase();
  let score = 0;

  for (const hint of KEYWORD_HINTS) {
    if (lower.includes(hint)) score += hint.length >= 8 ? 3 : 2;
  }

  for (const name of playerNames) {
    const n = name.trim().toLowerCase();
    if (n.length < 3) continue;
    if (lower.includes(n)) score += 8;
    else {
      const last = n.split(/\s+/).pop();
      if (last && last.length >= 4 && lower.includes(last)) score += 4;
    }
  }

  // Prefer mid-length chunks over tiny fragments or walls of text
  if (chunk.length >= 80 && chunk.length <= 420) score += 1;

  return score;
}

/**
 * Return the highest-scoring body passages, joined for display.
 * Falls back to a trimmed lead-in when nothing scores.
 */
export function pickRelevantChunks(
  text: string | null | undefined,
  opts: {
    playerNames?: string[];
    maxChunks?: number;
    maxChars?: number;
  } = {},
): string {
  const raw = text?.trim() ?? "";
  if (!raw) return "";
  // Never surface Google News / Bing aggregator slogans as "excerpts".
  if (/comprehensive up-to-date news coverage/i.test(raw)) {
    const stripped = raw
      .replace(/comprehensive up-to-date news coverage[\s\S]*?(?:google news\.?|bing news\.?)/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!stripped || stripped.length < 40) return "";
    return pickRelevantChunks(stripped, opts);
  }

  const maxChunks = opts.maxChunks ?? 2;
  const maxChars = opts.maxChars ?? 420;
  const playerNames = opts.playerNames ?? [];

  const chunks = splitBodyIntoChunks(raw);
  if (chunks.length === 0) return raw.slice(0, maxChars);

  const ranked = chunks
    .map((chunk, index) => ({ chunk, index, score: scoreChunk(chunk, playerNames) }))
    .sort((a, b) => b.score - a.score || a.index - b.index);

  const selected = ranked
    .filter((r) => r.score > 0)
    .slice(0, maxChunks)
    .sort((a, b) => a.index - b.index);

  const picked = (selected.length > 0 ? selected : ranked.slice(0, 1)).map((r) => r.chunk);

  let out = "";
  for (const piece of picked) {
    const next = out ? `${out} … ${piece}` : piece;
    if (next.length > maxChars) {
      if (!out) return piece.slice(0, maxChars).trim();
      break;
    }
    out = next;
  }
  return out.trim();
}
