import fs from "node:fs";
import path from "node:path";
import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import { createClient } from "@/lib/supabase/server";
import { fetchLeagueBundle, userTeam } from "@/lib/league/data";
import { loadSeasonAnalysisRows } from "@/lib/league/season-analysis-data";

let sqlJsPromise: Promise<SqlJsStatic> | null = null;

async function loadSqlJs(): Promise<SqlJsStatic> {
  if (!sqlJsPromise) {
    sqlJsPromise = initSqlJs({
      locateFile: (file) =>
        path.join(process.cwd(), "node_modules", "sql.js", "dist", file),
    });
  }
  return sqlJsPromise;
}

const BASE_TABLES = new Set([
  "season_players",
  "espn_week_points",
  "league_rosters",
  "defense_vs_position",
  "nfl_player_weeks",
  "schedule_games",
]);

export interface AnalysisSqlResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
}

export interface AnalysisWorkspace {
  ensureReady(): Promise<void>;
  listTables(): { name: string; kind: "base" | "scratch"; approxRows: number | null }[];
  describeTable(name: string): { name: string; columns: { name: string; type: string }[] };
  runSql(sql: string): AnalysisSqlResult | { message: string };
  writeCsvFromSql(fileName: string, sql: string): { fileName: string; bytes: number; rowCount: number };
  listFiles(): { name: string; bytes: number }[];
  readFile(fileName: string, maxChars?: number): { name: string; content: string; truncated: boolean };
  loadCsvAsTable(fileName: string, tableName: string): { table: string; rows: number };
  schemaHelp(): string;
}

function quoteIdent(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Invalid identifier: ${name}`);
  }
  return `"${name}"`;
}

function escapeSqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function sqlLiteral(value: unknown): string {
  if (value == null) return "NULL";
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "NULL";
  }
  if (typeof value === "boolean") return value ? "1" : "0";
  return escapeSqlString(String(value));
}

function insertRows(db: Database, table: string, columns: string[], rows: Record<string, unknown>[]) {
  if (rows.length === 0) return;
  const cols = columns.map(quoteIdent).join(", ");
  const chunk = 200;
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    const values = slice
      .map((row) => `(${columns.map((c) => sqlLiteral(row[c])).join(", ")})`)
      .join(",\n");
    db.run(`INSERT INTO ${quoteIdent(table)} (${cols}) VALUES ${values};`);
  }
}

/** Strip comments and validate a single analysis statement. */
export function assertSafeAnalysisSql(sql: string): string {
  const noBlock = sql.replace(/\/\*[\s\S]*?\*\//g, " ");
  const noLine = noBlock.replace(/--[^\n]*/g, " ");
  const trimmed = noLine.trim().replace(/;+\s*$/g, "").trim();
  if (!trimmed) throw new Error("Empty SQL");
  if (trimmed.length > 12_000) throw new Error("SQL too long");
  if (trimmed.includes(";")) throw new Error("Only one SQL statement allowed");

  const upper = trimmed.toUpperCase().replace(/\s+/g, " ").trim();
  const blocked =
    /\b(ATTACH|DETACH|PRAGMA|VACUUM|REINDEX|ALTER|UPDATE|REPLACE|GRANT|REVOKE|TRUNCATE|INTO\s+OUTFILE|LOAD_EXTENSION|COPY)\b/;
  if (blocked.test(upper)) {
    throw new Error("Statement type not allowed in analysis workspace");
  }

  const ok =
    /^(WITH|SELECT|CREATE\s+TEMP\s+TABLE|CREATE\s+TABLE|CREATE\s+VIEW|DROP\s+TABLE|DROP\s+VIEW|INSERT\s+INTO|DELETE\s+FROM)\b/.test(
      upper,
    );
  if (!ok) {
    throw new Error(
      "Allowed: SELECT/WITH, CREATE TABLE/TEMP TABLE/VIEW, DROP TABLE/VIEW, INSERT INTO scratch_*, DELETE FROM scratch_*",
    );
  }

  // Protect base datasets from mutation.
  if (/^(INSERT|DELETE|DROP|CREATE)\b/.test(upper)) {
    const m =
      upper.match(
        /^(?:INSERT\s+INTO|DELETE\s+FROM|DROP\s+TABLE(?:\s+IF\s+EXISTS)?|DROP\s+VIEW(?:\s+IF\s+EXISTS)?|CREATE\s+(?:TEMP\s+)?TABLE(?:\s+IF\s+NOT\s+EXISTS)?|CREATE\s+VIEW(?:\s+IF\s+NOT\s+EXISTS)?)\s+("?[A-Z0-9_]+"?)/,
      ) ?? null;
    const raw = (m?.[1] ?? "").replace(/"/g, "").toLowerCase();
    if (!raw) {
      throw new Error("Could not parse target table for mutating statement");
    }
    if (!raw.startsWith("scratch_") && !raw.startsWith("tmp_")) {
      throw new Error("Mutations only allowed on scratch_* / tmp_* tables");
    }
    if (BASE_TABLES.has(raw)) {
      throw new Error(`Cannot mutate base table ${raw}`);
    }
  }

  return trimmed;
}

function resultFromExec(db: Database, sql: string, maxRows = 200): AnalysisSqlResult {
  const result = db.exec(sql);
  if (result.length === 0) {
    return { columns: [], rows: [], rowCount: 0, truncated: false };
  }
  const table = result[0]!;
  const columns = table.columns;
  const truncated = table.values.length > maxRows;
  const values = truncated ? table.values.slice(0, maxRows) : table.values;
  const rows = values.map((vals) => {
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < columns.length; i++) {
      obj[columns[i]!] = vals[i] ?? null;
    }
    return obj;
  });
  return { columns, rows, rowCount: rows.length, truncated };
}

function toCsv(columns: string[], rows: Record<string, unknown>[]): string {
  const esc = (v: unknown) => {
    if (v == null) return "";
    const s = String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [columns.join(",")];
  for (const row of rows) {
    lines.push(columns.map((c) => esc(row[c])).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function parseSimpleCsv(text: string): { columns: string[]; rows: Record<string, unknown>[] } {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return { columns: [], rows: [] };
  // naive split — good enough for our own exports
  const columns = lines[0]!.split(",").map((c) => c.trim());
  const rows: Record<string, unknown>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i]!.split(",");
    const row: Record<string, unknown> = {};
    for (let c = 0; c < columns.length; c++) {
      const raw = (cols[c] ?? "").trim();
      if (raw === "") row[columns[c]!] = null;
      else if (/^-?\d+(\.\d+)?$/.test(raw)) row[columns[c]!] = Number(raw);
      else row[columns[c]!] = raw.replace(/^"|"$/g, "").replace(/""/g, '"');
    }
    rows.push(row);
  }
  return { columns, rows };
}

export function createAnalysisWorkspace(leagueId: string): AnalysisWorkspace {
  let db: Database | null = null;
  let ready: Promise<void> | null = null;
  const files = new Map<string, string>();

  async function hydrate() {
    const SQL = await loadSqlJs();
    db = new SQL.Database();
    const supabase = await createClient();
    const bundle = await fetchLeagueBundle(leagueId);
    if (!bundle) throw new Error("League not found");
    const season = bundle.league.season;
    const mine = userTeam(bundle);

    db.run(`
      CREATE TABLE season_players (
        espn_player_id INTEGER,
        name TEXT,
        position TEXT,
        nfl_team TEXT,
        fantasy_team TEXT,
        available INTEGER,
        games INTEGER,
        mean REAL,
        stdev REAL,
        cv REAL,
        consistency_score REAL,
        floor REAL,
        ceiling REAL,
        boom_rate REAL,
        bust_rate REAL,
        week_proj REAL,
        ros_proj REAL
      );
      CREATE TABLE espn_week_points (
        espn_player_id INTEGER,
        season INTEGER,
        week INTEGER,
        actual_points REAL,
        projected_points REAL
      );
      CREATE TABLE league_rosters (
        espn_player_id INTEGER,
        player_name TEXT,
        position TEXT,
        nfl_team TEXT,
        espn_team_id INTEGER,
        fantasy_team TEXT,
        lineup_slot TEXT,
        fp_player_id TEXT,
        is_my_team INTEGER
      );
      CREATE TABLE defense_vs_position (
        season INTEGER,
        defense_team TEXT,
        position TEXT,
        games INTEGER,
        fant_pts_avg REAL,
        fant_pts_ppr_avg REAL,
        fant_pts_rank INTEGER,
        rush_att INTEGER,
        rush_yds INTEGER,
        rush_ypc REAL,
        rush_ypc_vs_avg REAL,
        pass_att INTEGER,
        pass_yds INTEGER,
        pass_ypa REAL,
        targets INTEGER,
        receptions INTEGER,
        rec_yds INTEGER
      );
      CREATE TABLE nfl_player_weeks (
        season INTEGER,
        week INTEGER,
        player_id TEXT,
        player_name TEXT,
        position TEXT,
        team TEXT,
        opponent_team TEXT,
        fantasy_points REAL,
        fantasy_points_ppr REAL,
        carries INTEGER,
        rushing_yards INTEGER,
        rushing_tds INTEGER,
        targets INTEGER,
        receptions INTEGER,
        receiving_yards INTEGER,
        receiving_tds INTEGER,
        attempts INTEGER,
        passing_yards INTEGER,
        passing_tds INTEGER
      );
      CREATE TABLE schedule_games (
        season INTEGER,
        week INTEGER,
        game_type TEXT,
        home_team TEXT,
        away_team TEXT,
        gameday TEXT
      );
    `);

    const { rows: analysisRows } = await loadSeasonAnalysisRows(leagueId);
    insertRows(
      db,
      "season_players",
      [
        "espn_player_id",
        "name",
        "position",
        "nfl_team",
        "fantasy_team",
        "available",
        "games",
        "mean",
        "stdev",
        "cv",
        "consistency_score",
        "floor",
        "ceiling",
        "boom_rate",
        "bust_rate",
        "week_proj",
        "ros_proj",
      ],
      analysisRows.map((r) => ({
        espn_player_id: r.espnPlayerId,
        name: r.name,
        position: r.position,
        nfl_team: r.nflTeam,
        fantasy_team: r.fantasyTeam,
        available: r.available ? 1 : 0,
        games: r.games,
        mean: r.mean,
        stdev: r.stdev,
        cv: r.cv,
        consistency_score: r.consistencyScore,
        floor: r.floor,
        ceiling: r.ceiling,
        boom_rate: r.boomRate,
        bust_rate: r.bustRate,
        week_proj: r.weekProj,
        ros_proj: r.rosProj,
      })),
    );

    const teamName = new Map(bundle.teams.map((t) => [t.espn_team_id, t.name]));
    insertRows(
      db,
      "league_rosters",
      [
        "espn_player_id",
        "player_name",
        "position",
        "nfl_team",
        "espn_team_id",
        "fantasy_team",
        "lineup_slot",
        "fp_player_id",
        "is_my_team",
      ],
      bundle.rosterEntries.map((r) => ({
        espn_player_id: r.espn_player_id,
        player_name: r.player_name,
        position: r.position,
        nfl_team: r.nfl_team,
        espn_team_id: r.espn_team_id,
        fantasy_team: teamName.get(r.espn_team_id) ?? null,
        lineup_slot: r.lineup_slot,
        fp_player_id: r.fp_player_id,
        is_my_team: mine && r.espn_team_id === mine.espn_team_id ? 1 : 0,
      })),
    );

    const espnIds = [...new Set(bundle.rosterEntries.map((r) => r.espn_player_id))];
    if (espnIds.length > 0) {
      const { data: weekPts } = await supabase
        .from("espn_player_week_points")
        .select("espn_player_id, season, week, actual_points, projected_points")
        .eq("league_id", leagueId)
        .in("espn_player_id", espnIds)
        .in("season", [season, season - 1])
        .gte("week", 1);
      insertRows(
        db,
        "espn_week_points",
        ["espn_player_id", "season", "week", "actual_points", "projected_points"],
        (weekPts ?? []).map((r) => ({
          espn_player_id: r.espn_player_id,
          season: r.season,
          week: r.week,
          actual_points: r.actual_points,
          projected_points: r.projected_points,
        })),
      );
    }

    const { data: defense } = await supabase
      .from("nfl_defense_vs_position")
      .select(
        "season, defense_team, position, games, fant_pts_avg, fant_pts_ppr_avg, fant_pts_rank, rush_att, rush_yds, rush_ypc, rush_ypc_vs_avg, pass_att, pass_yds, pass_ypa, targets, receptions, rec_yds",
      )
      .eq("season", season);
    insertRows(
      db,
      "defense_vs_position",
      [
        "season",
        "defense_team",
        "position",
        "games",
        "fant_pts_avg",
        "fant_pts_ppr_avg",
        "fant_pts_rank",
        "rush_att",
        "rush_yds",
        "rush_ypc",
        "rush_ypc_vs_avg",
        "pass_att",
        "pass_yds",
        "pass_ypa",
        "targets",
        "receptions",
        "rec_yds",
      ],
      (defense ?? []) as Record<string, unknown>[],
    );

    const { data: weeks } = await supabase
      .from("nfl_player_week_stats")
      .select(
        "season, week, player_id, player_name, position, team, opponent_team, fantasy_points, fantasy_points_ppr, carries, rushing_yards, rushing_tds, targets, receptions, receiving_yards, receiving_tds, attempts, passing_yards, passing_tds",
      )
      .eq("season", season)
      .eq("season_type", "REG");
    insertRows(
      db,
      "nfl_player_weeks",
      [
        "season",
        "week",
        "player_id",
        "player_name",
        "position",
        "team",
        "opponent_team",
        "fantasy_points",
        "fantasy_points_ppr",
        "carries",
        "rushing_yards",
        "rushing_tds",
        "targets",
        "receptions",
        "receiving_yards",
        "receiving_tds",
        "attempts",
        "passing_yards",
        "passing_tds",
      ],
      (weeks ?? []) as Record<string, unknown>[],
    );

    const { data: schedule } = await supabase
      .from("nfl_schedule_games")
      .select("season, week, game_type, home_team, away_team, gameday")
      .eq("season", season);
    insertRows(
      db,
      "schedule_games",
      ["season", "week", "game_type", "home_team", "away_team", "gameday"],
      (schedule ?? []).map((r) => ({
        ...r,
        gameday: r.gameday != null ? String(r.gameday) : null,
      })),
    );

    // Seed helpful example scratch note as a tiny CSV for the agent.
    files.set(
      "README_analysis.txt",
      [
        "Analysis workspace (in-memory SQLite + CSV scratch).",
        "Base tables are read-only. Create scratch_* tables for intermediates.",
        "Example — defense vs RBs normalized by RB season averages:",
        "WITH rb_avgs AS (",
        "  SELECT player_id, AVG(fantasy_points) AS avg_fp",
        "  FROM nfl_player_weeks WHERE position='RB' GROUP BY player_id",
        "),",
        "faced AS (",
        "  SELECT w.opponent_team AS defense_team,",
        "         AVG(w.fantasy_points - a.avg_fp) AS fp_vs_rb_avg,",
        "         AVG(w.fantasy_points) AS fp_allowed,",
        "         COUNT(*) AS n",
        "  FROM nfl_player_weeks w",
        "  JOIN rb_avgs a ON a.player_id = w.player_id",
        "  WHERE w.position='RB'",
        "  GROUP BY w.opponent_team",
        ")",
        "SELECT * FROM faced ORDER BY fp_vs_rb_avg ASC LIMIT 15;",
        "",
      ].join("\n"),
    );
  }

  const api: AnalysisWorkspace = {
    ensureReady() {
      if (!ready) {
        ready = hydrate().catch((err) => {
          ready = null;
          db = null;
          throw err;
        });
      }
      return ready;
    },

    listTables() {
      if (!db) throw new Error("Workspace not ready");
      const res = db.exec(
        `SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name`,
      );
      const names = (res[0]?.values ?? []).map((v) => String(v[0]));
      return names.map((name) => {
        let approxRows: number | null = null;
        try {
          const c = db!.exec(`SELECT COUNT(*) FROM ${quoteIdent(name)}`);
          approxRows = Number(c[0]?.values?.[0]?.[0] ?? 0);
        } catch {
          approxRows = null;
        }
        return {
          name,
          kind: BASE_TABLES.has(name) ? ("base" as const) : ("scratch" as const),
          approxRows,
        };
      });
    },

    describeTable(name: string) {
      if (!db) throw new Error("Workspace not ready");
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error("Invalid table name");
      const info = db.exec(`PRAGMA table_info(${quoteIdent(name)})`);
      if (!info[0]) throw new Error(`Table not found: ${name}`);
      const cols = info[0].values.map((v) => ({
        name: String(v[1]),
        type: String(v[2] || "ANY"),
      }));
      return { name, columns: cols };
    },

    runSql(sql: string) {
      if (!db) throw new Error("Workspace not ready");
      const safe = assertSafeAnalysisSql(sql);
      const upper = safe.toUpperCase().replace(/\s+/g, " ");
      if (/^(SELECT|WITH)\b/.test(upper)) {
        return resultFromExec(db, safe, 200);
      }
      db.run(safe);
      return { message: "OK", columns: [], rows: [], rowCount: 0, truncated: false };
    },

    writeCsvFromSql(fileName: string, sql: string) {
      if (!db) throw new Error("Workspace not ready");
      const safeName = fileName.replace(/[^\w.\-]+/g, "_").slice(0, 80);
      if (!safeName.endsWith(".csv")) throw new Error("fileName must end with .csv");
      const safe = assertSafeAnalysisSql(sql);
      if (!/^(SELECT|WITH)\b/i.test(safe)) throw new Error("write_csv requires a SELECT");
      const result = resultFromExec(db, safe, 5000);
      const csv = toCsv(result.columns, result.rows);
      files.set(safeName, csv);
      return { fileName: safeName, bytes: Buffer.byteLength(csv, "utf8"), rowCount: result.rowCount };
    },

    listFiles() {
      return [...files.entries()].map(([name, content]) => ({
        name,
        bytes: Buffer.byteLength(content, "utf8"),
      }));
    },

    readFile(fileName: string, maxChars = 8000) {
      const content = files.get(fileName);
      if (content == null) throw new Error(`File not found: ${fileName}`);
      if (content.length <= maxChars) {
        return { name: fileName, content, truncated: false };
      }
      return {
        name: fileName,
        content: content.slice(0, maxChars),
        truncated: true,
      };
    },

    loadCsvAsTable(fileName: string, tableName: string) {
      if (!db) throw new Error("Workspace not ready");
      if (!tableName.startsWith("scratch_") && !tableName.startsWith("tmp_")) {
        throw new Error("CSV imports must use scratch_* / tmp_* table names");
      }
      const content = files.get(fileName);
      if (content == null) throw new Error(`File not found: ${fileName}`);
      const { columns, rows } = parseSimpleCsv(content);
      if (columns.length === 0) throw new Error("CSV has no header");
      db.run(`DROP TABLE IF EXISTS ${quoteIdent(tableName)}`);
      const colDefs = columns.map((c) => `${quoteIdent(c)} TEXT`).join(", ");
      db.run(`CREATE TABLE ${quoteIdent(tableName)} (${colDefs})`);
      insertRows(db, tableName, columns, rows);
      return { table: tableName, rows: rows.length };
    },

    schemaHelp() {
      return [
        "Base tables (read-only):",
        "- season_players: league roster analysis (mean/stdev/cv/consistency_score/week_proj/ros_proj)",
        "- espn_week_points: ESPN weekly actual/projected points for rostered players",
        "- league_rosters: ESPN roster rows + is_my_team",
        "- defense_vs_position: aggregated D vs QB/RB/WR/TE",
        "- nfl_player_weeks: nflverse weekly player fantasy/box stats (for custom matchup math)",
        "- schedule_games: NFL schedule",
        "Scratch: CREATE TABLE scratch_x AS SELECT ...; CSV via analysis_write_csv / analysis_load_csv.",
        "Mutations only on scratch_*/tmp_*. Prefer analysis_sql for novel stats instead of new tools.",
      ].join("\n");
    },
  };

  return api;
}

/** Optional: verify wasm file exists at build/dev time. */
export function sqlJsWasmPath(): string {
  return path.join(process.cwd(), "node_modules", "sql.js", "dist", "sql-wasm.wasm");
}

export function sqlJsWasmPresent(): boolean {
  try {
    return fs.existsSync(sqlJsWasmPath());
  } catch {
    return false;
  }
}
