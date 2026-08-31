export type NewsSource =
  | "google-news"
  | "bing-news"
  | "espn"
  | "reddit"
  | "brave"
  | "duckduckgo-instant";

export type NewsSeverity = "out" | "doubtful" | "questionable" | "news" | "rumor";

export type NewsBucket = "needs_action" | "monitor" | "fyi";

export type NewsTriageStatus = "new" | "read" | "dismissed" | "actioned";

export type PlayerScopeKind = "roster" | "watchlist" | "opponent";

export interface RosterPlayerForNews {
  espnPlayerId: number;
  name: string;
  position: string;
  nflTeam: string | null;
  lineupSlot: string;
  injuryStatus: string | null;
  headshotUrl: string | null;
  isStarter: boolean;
  scope: PlayerScopeKind;
}

export interface MatchedPlayerRef {
  espnPlayerId: number;
  name: string;
  scope: PlayerScopeKind;
}

export interface RawNewsHit {
  title: string;
  url: string;
  snippet: string;
  source: NewsSource;
  publishedAt: string | null;
  redditFlair?: string | null;
}

export interface NewsItemView {
  id: string;
  title: string;
  url: string;
  snippet: string;
  source: NewsSource;
  severity: NewsSeverity;
  bucket: NewsBucket;
  score: number;
  publishedAt: string | null;
  matchedPlayers: MatchedPlayerRef[];
  corroborationCount: number;
  triageStatus: NewsTriageStatus;
  redditFlair?: string | null;
}

export interface InjuryDeltaView {
  espnPlayerId: number;
  playerName: string;
  fromStatus: string | null;
  toStatus: string;
  detectedAt: string;
}

export interface InjuryBoardPlayer {
  espnPlayerId: number;
  name: string;
  position: string;
  nflTeam: string | null;
  lineupSlot: string;
  injuryStatus: string;
  headshotUrl: string | null;
  isStarter: boolean;
  scope: PlayerScopeKind;
  delta: InjuryDeltaView | null;
}

export interface NewsTriageResponse {
  fetchedAt: string;
  cached: boolean;
  lastSyncedAt: string | null;
  injuryBoard: InjuryBoardPlayer[];
  feed: NewsItemView[];
  providerNotes?: string;
  /** Populated on refresh — helps diagnose empty/stale feeds. */
  fetchStats?: NewsFetchStats;
}

export interface NewsFetchStats {
  googleNewsHits: number;
  bingHits: number;
  redditHits: number;
  topStoryHits: number;
  rawTotal: number;
  feedTotal: number;
  sourceErrors: number;
  newestPublishedAt: string | null;
}

export interface NewsFeedFilter {
  source?: NewsSource | "all";
  bucket?: NewsBucket | "all";
  startersOnly?: boolean;
  unreadOnly?: boolean;
}
