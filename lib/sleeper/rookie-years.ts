/**
 * NFL draft / rookie-year lookup via Sleeper's public players dump.
 * Matched primarily by Sportradar UUID (FantasyPros `sportsdata_id`).
 */

export interface DraftYearLookup {
  bySportradarId: Map<string, number>;
  byYahooId: Map<string, number>;
  byNormalizedName: Map<string, number>;
}

const SLEEPER_PLAYERS_URL = "https://api.sleeper.app/v1/players/nfl";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

let cache: { at: number; lookup: DraftYearLookup } | null = null;

export function normalizePlayerName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’.]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function parseYear(raw: unknown): number | null {
  if (raw == null) return null;
  const n = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n)) return null;
  const year = Math.trunc(n);
  if (year < 1980 || year > 2100) return null;
  return year;
}

/** Pure helper for unit tests — build indexes from a Sleeper players map. */
export function buildDraftYearLookup(
  players: Record<string, unknown>,
): DraftYearLookup {
  const bySportradarId = new Map<string, number>();
  const byYahooId = new Map<string, number>();
  const byNormalizedName = new Map<string, number>();

  for (const value of Object.values(players)) {
    if (!value || typeof value !== "object") continue;
    const p = value as Record<string, unknown>;
    const meta =
      p.metadata && typeof p.metadata === "object"
        ? (p.metadata as Record<string, unknown>)
        : null;
    const year = parseYear(meta?.rookie_year);
    if (year == null) continue;

    const sportradar = typeof p.sportradar_id === "string" ? p.sportradar_id.trim() : "";
    if (sportradar) bySportradarId.set(sportradar.toLowerCase(), year);

    if (p.yahoo_id != null && String(p.yahoo_id).trim()) {
      byYahooId.set(String(p.yahoo_id).trim(), year);
    }

    const fullName = typeof p.full_name === "string" ? p.full_name : "";
    const normalized = fullName ? normalizePlayerName(fullName) : "";
    if (normalized && !byNormalizedName.has(normalized)) {
      byNormalizedName.set(normalized, year);
    }
  }

  return { bySportradarId, byYahooId, byNormalizedName };
}

export function resolveDraftYear(
  lookup: DraftYearLookup,
  ids: {
    sportsdataId?: string | null;
    yahooId?: string | null;
    name?: string | null;
  },
): number | null {
  const sr = ids.sportsdataId?.trim().toLowerCase();
  if (sr) {
    const year = lookup.bySportradarId.get(sr);
    if (year != null) return year;
  }

  const yahoo = ids.yahooId?.trim();
  if (yahoo) {
    const year = lookup.byYahooId.get(yahoo);
    if (year != null) return year;
  }

  const name = ids.name ? normalizePlayerName(ids.name) : "";
  if (name) {
    const year = lookup.byNormalizedName.get(name);
    if (year != null) return year;
  }

  return null;
}

export async function fetchDraftYearLookup(options?: {
  forceRefresh?: boolean;
  signal?: AbortSignal;
}): Promise<DraftYearLookup> {
  const now = Date.now();
  if (!options?.forceRefresh && cache && now - cache.at < CACHE_TTL_MS) {
    return cache.lookup;
  }

  const res = await fetch(SLEEPER_PLAYERS_URL, {
    cache: "no-store",
    signal: options?.signal ?? AbortSignal.timeout(45_000),
  });
  if (!res.ok) {
    throw new Error(`Sleeper players fetch failed (${res.status})`);
  }

  const json = (await res.json()) as Record<string, unknown>;
  const lookup = buildDraftYearLookup(json);
  cache = { at: now, lookup };
  return lookup;
}

/** Test helper to clear the module cache. */
export function clearDraftYearLookupCache(): void {
  cache = null;
}
