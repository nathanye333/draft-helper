/**
 * Per-feed-item chunk ranking: keyword + player + roster scope + anti-boilerplate.
 * Replaces global semantic search for triage/digest — articles are already scoped
 * to the user's players; we pick the best passage inside each story.
 */

import type { MatchedPlayerRef, NewsBucket } from "@/lib/news/types";
import { pickRelevantChunks, scoreChunk } from "@/lib/news/relevant-chunks";
import { EXCERPT_CHUNKS_PER_ITEM, FEED_EXCERPT_MAX_CHARS } from "@/lib/news/excerpt-limits";

export interface FeedItemForChunkRank {
  id: string;
  title: string;
  snippet: string;
  score: number;
  bucket: NewsBucket;
  matchedPlayers: MatchedPlayerRef[];
}

export interface RankedChunk {
  chunkIndex: number;
  content: string;
  score: number;
}

/** Generic season-preview / listicle noise that pollutes semantic search. */
const BOILERPLATE_PATTERNS: RegExp[] = [
  /fantasy football bust/i,
  /riskiest fantasy picks/i,
  /simulated the new nfl season/i,
  /10,?000 times/i,
  /training camps in full swing/i,
  /draft season is set to begin/i,
  /fantasy draft prep/i,
  /sleepers, busts and breakouts/i,
  /first-round fantasy draft pick/i,
  /dynasty leagues before the \d{4}/i,
  /subscribe on apple podcasts/i,
  /check out the full conversation/i,
  /wherever you listen/i,
  /fantasy football rankings \d{4}/i,
  /boom or bust players in \d{4}/i,
  /comprehensive up-to-date news coverage/i,
];

export function isBoilerplateChunk(text: string): boolean {
  return BOILERPLATE_PATTERNS.some((p) => p.test(text));
}

function chunkMentionsPlayer(chunk: string, name: string): boolean {
  const lower = chunk.toLowerCase();
  const n = name.trim().toLowerCase();
  if (n.length < 3) return false;
  if (lower.includes(n)) return true;
  const last = n.split(/\s+/).pop();
  return Boolean(last && last.length >= 4 && lower.includes(last));
}

function titleWordOverlap(title: string, chunk: string): number {
  const words = title
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 4);
  const chunkLower = chunk.toLowerCase();
  let overlap = 0;
  for (const w of words.slice(0, 10)) {
    if (chunkLower.includes(w)) overlap += 1;
  }
  return overlap;
}

/** Score a passage for a specific triage feed item (higher = more actionable). */
export function scoreChunkForFeedItem(chunk: string, item: FeedItemForChunkRank): number {
  const playerNames = item.matchedPlayers.map((p) => p.name);
  let score = scoreChunk(chunk, playerNames);

  for (const p of item.matchedPlayers) {
    if (!chunkMentionsPlayer(chunk, p.name)) continue;
    if (p.scope === "roster") score += 14;
    else if (p.scope === "watchlist") score += 7;
    else score += 3;
  }

  if (isBoilerplateChunk(chunk)) score -= 30;

  const normalized = chunk.replace(/\s+/g, " ").trim();
  if (normalized.length >= 40) {
    const half = Math.floor(normalized.length / 2);
    if (normalized.slice(0, half) === normalized.slice(half)) score -= 20;
  }

  if (item.bucket === "needs_action") score += 6;
  else if (item.bucket === "monitor") score += 3;

  score += Math.min(titleWordOverlap(item.title, chunk), 5);

  const hasPlayer = playerNames.some((n) => chunkMentionsPlayer(chunk, n));
  const keywordOnly = scoreChunk(chunk, []);
  if (!hasPlayer && keywordOnly < 5) score -= 25;

  // Tie-break toward higher-priority feed items when passages are similar.
  score += item.score * 0.15;

  return score;
}

export function rankChunksForFeedItem(
  chunks: Array<{ chunkIndex: number; content: string }>,
  item: FeedItemForChunkRank,
  opts: { maxChunks?: number; minScore?: number } = {},
): RankedChunk[] {
  const maxChunks = opts.maxChunks ?? EXCERPT_CHUNKS_PER_ITEM;
  const minScore = opts.minScore ?? 4;

  const ranked = chunks
    .map((c) => ({
      chunkIndex: c.chunkIndex,
      content: c.content.trim(),
      score: scoreChunkForFeedItem(c.content, item),
    }))
    .filter((c) => c.content.length >= 40 && !isBoilerplateChunk(c.content))
    .sort((a, b) => b.score - a.score || a.chunkIndex - b.chunkIndex);

  const strong = ranked.filter((c) => c.score >= minScore).slice(0, maxChunks);

  // Most articles only have one or two passages that clear minScore. Top up with
  // the next-best non-boilerplate passages so excerpts stay substantive instead
  // of collapsing to a single sentence.
  if (strong.length < maxChunks) {
    const chosen = new Set(strong.map((c) => c.chunkIndex));
    for (const candidate of ranked) {
      if (strong.length >= maxChunks) break;
      if (chosen.has(candidate.chunkIndex)) continue;
      strong.push(candidate);
      chosen.add(candidate.chunkIndex);
    }
  }

  // Read in article order so multi-passage excerpts stay coherent.
  if (strong.length > 0) {
    return strong.sort((a, b) => a.chunkIndex - b.chunkIndex);
  }

  const fallback = pickRelevantChunks(
    chunks.map((c) => c.content).join("\n\n") || item.snippet,
    {
      playerNames: item.matchedPlayers.map((p) => p.name),
      maxChunks,
      maxChars: FEED_EXCERPT_MAX_CHARS,
    },
  );
  if (fallback && !isBoilerplateChunk(fallback)) {
    return [{ chunkIndex: 0, content: fallback, score: Math.max(minScore, 4) }];
  }

  return [];
}
