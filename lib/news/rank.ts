import { isStarterSlot } from "@/lib/league/slot-order";
import type {
  MatchedPlayerRef,
  NewsBucket,
  NewsSeverity,
  NewsSource,
  RawNewsHit,
  RosterPlayerForNews,
} from "@/lib/news/types";

const INJURY_KEYWORDS = [
  "injury",
  "injured",
  "ruled out",
  "out for",
  "inactive",
  "doubtful",
  "questionable",
  "limited",
  "did not practice",
  "dnP",
  "concussion",
  "hamstring",
  "ankle",
  "knee",
  "ir ",
  " injured reserve",
];

const RUMOR_KEYWORDS = ["rumor", "expected", "likely", "could", "might", "per source", "sources say"];

const OUT_KEYWORDS = ["ruled out", "will not play", "out for", " placed on ir", "inactive"];
const DOUBTFUL_KEYWORDS = ["doubtful"];
const QUESTIONABLE_KEYWORDS = ["questionable", "limited", "did not practice", "dnp"];

export function classifySeverity(hit: RawNewsHit, matchedPlayers: MatchedPlayerRef[]): NewsSeverity {
  const text = `${hit.title} ${hit.snippet}`.toLowerCase();

  if (OUT_KEYWORDS.some((k) => text.includes(k))) return "out";
  if (DOUBTFUL_KEYWORDS.some((k) => text.includes(k))) return "doubtful";
  if (QUESTIONABLE_KEYWORDS.some((k) => text.includes(k))) return "questionable";

  if (hit.source === "reddit" || RUMOR_KEYWORDS.some((k) => text.includes(k))) {
    return "rumor";
  }

  if (INJURY_KEYWORDS.some((k) => text.includes(k))) {
    return "questionable";
  }

  if (matchedPlayers.length > 0) return "news";
  return "news";
}

export function bucketForSeverity(
  severity: NewsSeverity,
  matchedPlayers: MatchedPlayerRef[],
  playersById: Map<number, RosterPlayerForNews>,
): NewsBucket {
  const hasInjuredStarter = matchedPlayers.some((m) => {
    const p = playersById.get(m.espnPlayerId);
    return p && isStarterSlot(p.lineupSlot) && (severity === "out" || severity === "doubtful");
  });

  if (hasInjuredStarter || severity === "out") return "needs_action";
  if (severity === "doubtful" || severity === "questionable") return "monitor";
  return "fyi";
}

export function scoreNewsItem(params: {
  hit: RawNewsHit;
  matchedPlayers: MatchedPlayerRef[];
  playersById: Map<number, RosterPlayerForNews>;
  corroborationCount: number;
}): number {
  const { hit, matchedPlayers, playersById, corroborationCount } = params;
  const text = `${hit.title} ${hit.snippet}`.toLowerCase();

  let score = 0;

  for (const m of matchedPlayers) {
    const player = playersById.get(m.espnPlayerId);
    if (!player) continue;
    score += m.scope === "roster" ? 3 : m.scope === "watchlist" ? 1.5 : 1;
    if (isStarterSlot(player.lineupSlot)) score += 2;
  }

  if (INJURY_KEYWORDS.some((k) => text.includes(k))) score += 2;
  if (hit.source === "espn") score += 1;
  if (hit.source === "reddit") score -= 0.5;
  if (corroborationCount > 1) score += (corroborationCount - 1) * 1.5;

  if (hit.publishedAt) {
    const ageHours = (Date.now() - Date.parse(hit.publishedAt)) / (1000 * 60 * 60);
    if (ageHours < 6) score += 2;
    else if (ageHours < 24) score += 1;
    else if (ageHours > 72) score -= 1;
  }

  return score;
}

export function sourceLabel(source: NewsSource): string {
  switch (source) {
    case "google-news":
      return "Google News";
    case "bing-news":
      return "Bing";
    case "espn":
      return "ESPN";
    case "reddit":
      return "Reddit";
    case "brave":
      return "Brave";
    default:
      return source;
  }
}
