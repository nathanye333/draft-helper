import { createAdminClient } from "@/lib/supabase/admin";
import { numOrNull, parseCsv } from "@/lib/nflverse/csv";

export type SyncNflMatchupsResult =
  | { ok: true; season: number; defenseRows: number; scheduleRows: number; syncedAt: string }
  | { ok: false; reason: "api_error"; message: string };

const POSITIONS = new Set(["QB", "RB", "WR", "TE"]);

/** Normalize nflverse team codes to common fantasy abbreviations. */
export function normalizeNflTeam(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim().toUpperCase();
  if (!t || t === "NA" || t === "NULL") return null;
  const aliases: Record<string, string> = {
    LA: "LAR",
    STL: "LAR",
    SD: "LAC",
    OAK: "LV",
    WSH: "WAS",
    WASH: "WAS",
  };
  return aliases[t] ?? t;
}

type Agg = {
  weeks: Set<number>;
  fant: number;
  fantPpr: number;
  rushAtt: number;
  rushYds: number;
  passAtt: number;
  passYds: number;
  targets: number;
  receptions: number;
  recYds: number;
};

function emptyAgg(): Agg {
  return {
    weeks: new Set(),
    fant: 0,
    fantPpr: 0,
    rushAtt: 0,
    rushYds: 0,
    passAtt: 0,
    passYds: 0,
    targets: 0,
    receptions: 0,
    recYds: 0,
  };
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  return res.text();
}

/** nflverse renamed weekly player stats assets; try current then legacy paths. */
const PLAYER_STATS_URL_TEMPLATES = [
  (season: number) =>
    `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${season}.csv`,
  (season: number) =>
    `https://github.com/nflverse/nflverse-data/releases/download/player_stats/player_stats_${season}.csv`,
] as const;

async function fetchPlayerStatsCsv(season: number): Promise<string> {
  const errors: string[] = [];
  for (const tmpl of PLAYER_STATS_URL_TEMPLATES) {
    const url = tmpl(season);
    try {
      return await fetchText(url);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  throw new Error(errors.join(" | "));
}

/**
 * Aggregate nflverse weekly player stats into defense-vs-position rows.
 * Exported for unit tests.
 */
export function aggregateDefenseVsPosition(
  rows: Record<string, string>[],
  season: number,
): Array<{
  season: number;
  defense_team: string;
  position: string;
  games: number;
  fant_pts_avg: number | null;
  fant_pts_ppr_avg: number | null;
  rush_att: number;
  rush_yds: number;
  rush_ypc: number | null;
  pass_att: number;
  pass_yds: number;
  pass_ypa: number | null;
  targets: number;
  receptions: number;
  rec_yds: number;
}> {
  const byKey = new Map<string, Agg>();

  for (const row of rows) {
    if (numOrNull(row.season) !== season) continue;
    const seasonType = (row.season_type ?? "REG").toUpperCase();
    if (seasonType !== "REG") continue;
    const position = (row.position ?? "").toUpperCase();
    if (!POSITIONS.has(position)) continue;
    const defense = normalizeNflTeam(row.opponent_team);
    if (!defense) continue;
    const week = numOrNull(row.week);
    if (week == null || week < 1) continue;

    const key = `${defense}|${position}`;
    const agg = byKey.get(key) ?? emptyAgg();
    agg.weeks.add(week);
    agg.fant += numOrNull(row.fantasy_points) ?? 0;
    agg.fantPpr += numOrNull(row.fantasy_points_ppr) ?? 0;
    agg.rushAtt += numOrNull(row.carries) ?? 0;
    agg.rushYds += numOrNull(row.rushing_yards) ?? 0;
    agg.passAtt += numOrNull(row.attempts) ?? 0;
    agg.passYds += numOrNull(row.passing_yards) ?? 0;
    agg.targets += numOrNull(row.targets) ?? 0;
    agg.receptions += numOrNull(row.receptions) ?? 0;
    agg.recYds += numOrNull(row.receiving_yards) ?? 0;
    byKey.set(key, agg);
  }

  const out: ReturnType<typeof aggregateDefenseVsPosition> = [];
  for (const [key, agg] of byKey) {
    const [defense_team, position] = key.split("|") as [string, string];
    const games = agg.weeks.size;
    if (games <= 0) continue;
    out.push({
      season,
      defense_team,
      position,
      games,
      fant_pts_avg: Math.round((agg.fant / games) * 100) / 100,
      fant_pts_ppr_avg: Math.round((agg.fantPpr / games) * 100) / 100,
      rush_att: agg.rushAtt,
      rush_yds: agg.rushYds,
      rush_ypc:
        agg.rushAtt > 0 ? Math.round((agg.rushYds / agg.rushAtt) * 100) / 100 : null,
      pass_att: agg.passAtt,
      pass_yds: agg.passYds,
      pass_ypa:
        agg.passAtt > 0 ? Math.round((agg.passYds / agg.passAtt) * 100) / 100 : null,
      targets: agg.targets,
      receptions: agg.receptions,
      rec_yds: agg.recYds,
    });
  }
  return out;
}

/** Attach ranks (1 = softest / most fantasy points allowed) and YPC vs league avg. */
export function enrichDefenseRows(
  rows: ReturnType<typeof aggregateDefenseVsPosition>,
): Array<
  ReturnType<typeof aggregateDefenseVsPosition>[number] & {
    fant_pts_rank: number | null;
    fant_pts_ppr_rank: number | null;
    rush_ypc_vs_avg: number | null;
  }
> {
  const byPos = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = byPos.get(row.position) ?? [];
    list.push(row);
    byPos.set(row.position, list);
  }

  const rushYpcByPos = new Map<string, number>();
  for (const [pos, list] of byPos) {
    let att = 0;
    let yds = 0;
    for (const r of list) {
      att += r.rush_att;
      yds += r.rush_yds;
    }
    if (att > 0) rushYpcByPos.set(pos, yds / att);
  }

  const enriched: ReturnType<typeof enrichDefenseRows> = [];
  for (const [pos, list] of byPos) {
    const sortedStd = [...list].sort(
      (a, b) => (b.fant_pts_avg ?? -1) - (a.fant_pts_avg ?? -1),
    );
    const sortedPpr = [...list].sort(
      (a, b) => (b.fant_pts_ppr_avg ?? -1) - (a.fant_pts_ppr_avg ?? -1),
    );
    const stdRank = new Map(sortedStd.map((r, i) => [`${r.defense_team}`, i + 1]));
    const pprRank = new Map(sortedPpr.map((r, i) => [`${r.defense_team}`, i + 1]));
    const leagueYpc = rushYpcByPos.get(pos) ?? null;

    for (const r of list) {
      enriched.push({
        ...r,
        fant_pts_rank: stdRank.get(r.defense_team) ?? null,
        fant_pts_ppr_rank: pprRank.get(r.defense_team) ?? null,
        rush_ypc_vs_avg:
          r.rush_ypc != null && leagueYpc != null
            ? Math.round((r.rush_ypc - leagueYpc) * 100) / 100
            : null,
      });
    }
  }
  return enriched;
}

export function parseScheduleRows(
  rows: Record<string, string>[],
  season: number,
): Array<{
  season: number;
  week: number;
  game_type: string;
  home_team: string;
  away_team: string;
  gameday: string | null;
}> {
  const out: ReturnType<typeof parseScheduleRows> = [];
  for (const row of rows) {
    if (numOrNull(row.season) !== season) continue;
    const week = numOrNull(row.week);
    if (week == null || week < 1) continue;
    const home = normalizeNflTeam(row.home_team);
    const away = normalizeNflTeam(row.away_team);
    if (!home || !away) continue;
    const gameType = (row.game_type ?? row.season_type ?? "REG").toUpperCase();
    out.push({
      season,
      week,
      game_type: gameType,
      home_team: home,
      away_team: away,
      gameday: row.gameday || row.gameday_time || null,
    });
  }
  return out;
}

/**
 * Sync defense-vs-position + schedule for a season from nflverse public CSVs.
 * Falls back to season-1 player stats if the requested season file is empty/missing.
 */
export async function syncNflMatchupData(season: number): Promise<SyncNflMatchupsResult> {
  const syncedAt = new Date().toISOString();
  const admin = createAdminClient();

  let statsSeason = season;
  let playerCsv: string;
  try {
    playerCsv = await fetchPlayerStatsCsv(statsSeason);
  } catch (err) {
    if (season > 2000) {
      statsSeason = season - 1;
      try {
        playerCsv = await fetchPlayerStatsCsv(statsSeason);
      } catch (err2) {
        return {
          ok: false,
          reason: "api_error",
          message: err2 instanceof Error ? err2.message : "Failed to download player stats",
        };
      }
    } else {
      return {
        ok: false,
        reason: "api_error",
        message: err instanceof Error ? err.message : "Failed to download player stats",
      };
    }
  }

  const playerRows = parseCsv(playerCsv);
  let aggregated = aggregateDefenseVsPosition(playerRows, statsSeason);
  if (aggregated.length === 0 && statsSeason === season && season > 2000) {
    // Preseason / empty file — try prior completed season.
    statsSeason = season - 1;
    try {
      playerCsv = await fetchPlayerStatsCsv(statsSeason);
      aggregated = aggregateDefenseVsPosition(parseCsv(playerCsv), statsSeason);
    } catch {
      // keep empty
    }
  }

  if (aggregated.length === 0) {
    return {
      ok: false,
      reason: "api_error",
      message: `No REG player stats found for season ${season} (or ${season - 1}).`,
    };
  }

  const defenseRows = enrichDefenseRows(aggregated).map((r) => ({
    ...r,
    synced_at: syncedAt,
  }));

  // Store under the requested season key when we fell back, so league.season lookups work,
  // but keep statsSeason embedded via note in synced data — actually better to store under
  // statsSeason and also copy to requested season if different.
  const seasonsToWrite = statsSeason === season ? [season] : [statsSeason, season];
  for (const writeSeason of seasonsToWrite) {
    const payload = defenseRows.map((r) => ({ ...r, season: writeSeason }));
    const { error } = await admin
      .from("nfl_defense_vs_position")
      .upsert(payload, { onConflict: "season,defense_team,position" });
    if (error) {
      return { ok: false, reason: "api_error", message: error.message };
    }
  }

  let scheduleRows = 0;
  try {
    // Prefer nflverse-data schedules release; fall back to nfldata repo.
    let scheduleCsv: string;
    try {
      scheduleCsv = await fetchText(
        `https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv`,
      );
    } catch {
      scheduleCsv = await fetchText(
        `https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv`,
      );
    }
    const parsed = parseScheduleRows(parseCsv(scheduleCsv), season);
    // If empty for future season, also try statsSeason
    const schedulePayload =
      parsed.length > 0 ? parsed : parseScheduleRows(parseCsv(scheduleCsv), statsSeason);

    if (schedulePayload.length > 0) {
      const toWrite =
        parsed.length > 0
          ? schedulePayload
          : schedulePayload.map((g) => ({ ...g, season }));
      const { error } = await admin
        .from("nfl_schedule_games")
        .upsert(
          toWrite.map((g) => ({ ...g, synced_at: syncedAt })),
          { onConflict: "season,week,home_team,away_team" },
        );
      if (error) {
        console.warn("Schedule sync failed:", error.message);
      } else {
        scheduleRows = toWrite.length;
      }
    }
  } catch (err) {
    console.warn(
      "Schedule sync skipped:",
      err instanceof Error ? err.message : err,
    );
  }

  return {
    ok: true,
    season: statsSeason,
    defenseRows: defenseRows.length,
    scheduleRows,
    syncedAt,
  };
}
