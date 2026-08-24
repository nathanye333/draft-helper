import { buildPlayerMatchIndex, matchPlayersInText } from "@/lib/news/player-match";
import { isInjuryRelatedFlair, parseRedditFlair, REDDIT_SUBREDDITS } from "@/lib/news/sources/reddit";
import type { MatchedPlayerRef, RosterPlayerForNews } from "@/lib/news/types";

const USER_AGENT =
  "FantasyDraftHelper/0.1 (+https://github.com; draft-agent news alerts; not a scraper bot)";

/** Max age for a "spike" post (hours). */
const MAX_AGE_HOURS = 6;

export interface RedditSpikePost {
  id: string;
  subreddit: string;
  title: string;
  url: string;
  score: number;
  numComments: number;
  createdUtc: number;
  flair: string | null;
  matchedPlayers: MatchedPlayerRef[];
  spikeScore: number;
}

interface RedditListingChild {
  data?: {
    id?: string;
    name?: string;
    title?: string;
    permalink?: string;
    url?: string;
    score?: number;
    ups?: number;
    num_comments?: number;
    created_utc?: number;
    link_flair_text?: string | null;
    subreddit?: string;
  };
}

/**
 * Heuristic spike score from velocity proxies available on Reddit listings.
 * Higher = more alert-worthy.
 */
export function computeSpikeScore(params: {
  score: number;
  numComments: number;
  ageHours: number;
  injuryRelated: boolean;
  matchedStarter: boolean;
}): number {
  const { score, numComments, ageHours, injuryRelated, matchedStarter } = params;
  if (ageHours < 0 || ageHours > MAX_AGE_HOURS) return 0;

  // Prefer fresh posts: weight decays linearly over MAX_AGE_HOURS.
  const freshness = 1 - ageHours / MAX_AGE_HOURS;
  const engagement = score + numComments * 2;
  let spike = engagement * (0.35 + 0.65 * freshness);

  if (injuryRelated) spike *= 1.4;
  if (matchedStarter) spike *= 1.5;

  return spike;
}

/** True when engagement + context crosses the alert threshold. */
export function isSpikeAlertWorthy(spikeScore: number, rawScore: number, numComments: number): boolean {
  if (spikeScore < 40) return false;
  // Absolute floor so quiet threads never alert
  return rawScore >= 25 || numComments >= 15 || spikeScore >= 80;
}

async function fetchSubredditListing(
  subreddit: string,
  listing: "hot" | "rising",
  signal?: AbortSignal,
): Promise<RedditListingChild[]> {
  const url = `https://www.reddit.com/r/${subreddit}/${listing}.json?limit=40&raw_json=1`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": USER_AGENT,
    },
    signal: signal ?? AbortSignal.timeout(12_000),
  });
  if (!res.ok) {
    throw new Error(`Reddit ${listing} HTTP ${res.status} for r/${subreddit}`);
  }
  const json = (await res.json()) as { data?: { children?: RedditListingChild[] } };
  return json.data?.children ?? [];
}

export async function detectRedditSpikesForPlayers(
  players: RosterPlayerForNews[],
  signal?: AbortSignal,
): Promise<RedditSpikePost[]> {
  if (players.length === 0) return [];

  const index = buildPlayerMatchIndex(players);
  const nowSec = Date.now() / 1000;
  const byId = new Map<string, RedditSpikePost>();

  for (const sub of REDDIT_SUBREDDITS) {
    for (const listing of ["rising", "hot"] as const) {
      let children: RedditListingChild[] = [];
      try {
        children = await fetchSubredditListing(sub, listing, signal);
      } catch (err) {
        console.warn("[reddit-spikes]", err instanceof Error ? err.message : err);
        continue;
      }

      for (const child of children) {
        const d = child.data;
        if (!d?.id || !d.title) continue;

        const createdUtc = Number(d.created_utc ?? 0);
        const ageHours = (nowSec - createdUtc) / 3600;
        if (ageHours < 0 || ageHours > MAX_AGE_HOURS) continue;

        const { flair, cleanTitle } = parseRedditFlair(
          d.link_flair_text ? `[${d.link_flair_text}] ${d.title}` : d.title,
        );
        const title = cleanTitle || d.title;
        const matchedPlayers = matchPlayersInText(title, index);
        if (matchedPlayers.length === 0) continue;

        const score = Number(d.score ?? d.ups ?? 0);
        const numComments = Number(d.num_comments ?? 0);
        const injuryRelated =
          isInjuryRelatedFlair(flair) ||
          /\b(out|injury|injured|doubtful|questionable|ir\b|inactive)\b/i.test(title);
        const matchedStarter = matchedPlayers.some((p) => {
          const full = players.find((x) => x.espnPlayerId === p.espnPlayerId);
          return full?.isStarter && full.scope === "roster";
        });

        const spikeScore = computeSpikeScore({
          score,
          numComments,
          ageHours,
          injuryRelated,
          matchedStarter,
        });
        if (!isSpikeAlertWorthy(spikeScore, score, numComments)) continue;

        const permalink = d.permalink
          ? `https://www.reddit.com${d.permalink}`
          : d.url ?? `https://www.reddit.com/r/${sub}`;

        const existing = byId.get(d.id);
        if (existing && existing.spikeScore >= spikeScore) continue;

        byId.set(d.id, {
          id: d.id,
          subreddit: d.subreddit ?? sub,
          title,
          url: permalink,
          score,
          numComments,
          createdUtc,
          flair,
          matchedPlayers,
          spikeScore,
        });
      }
    }
  }

  return [...byId.values()].sort((a, b) => b.spikeScore - a.spikeScore);
}
