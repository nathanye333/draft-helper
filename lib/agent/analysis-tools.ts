import { tool } from "langchain";
import { z } from "zod";
import {
  analysisBaseSchemaText,
  createAnalysisWorkspace,
  type AnalysisWorkspace,
} from "@/lib/agent/analysis-workspace";

function json(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

/**
 * Free-form SQL + CSV scratchpad tools for the season agent.
 * Workspace is shared across tool calls within one agent request.
 * analysis_sql / analysis_write_csv stay gated until analysis_schema runs
 * (see createAnalysisSchemaMiddleware).
 */
export function createAnalysisWorkspaceTools(leagueId: string) {
  const workspace: AnalysisWorkspace = createAnalysisWorkspace(leagueId);

  const analysis_schema = tool(
    async () => {
      await workspace.ensureReady();
      return json({
        help: workspace.schemaHelp(),
        schema: analysisBaseSchemaText(),
        tables: workspace.listTables(),
        files: workspace.listFiles(),
      });
    },
    {
      name: "analysis_schema",
      description:
        "Load analysis workspace schema (required before analysis_sql). Returns tables, columns, and files.",
      schema: z.object({}),
    },
  );

  const analysis_describe_table = tool(
    async (input) => {
      await workspace.ensureReady();
      return json(workspace.describeTable(input.table));
    },
    {
      name: "analysis_describe_table",
      description:
        "Show columns for one analysis workspace table (also unlocks analysis_sql).",
      schema: z.object({
        table: z.string().min(1).max(80),
      }),
    },
  );

  const analysis_sql = tool(
    async (input) => {
      await workspace.ensureReady();
      try {
        const result = workspace.runSql(input.sql);
        return json(result);
      } catch (err) {
        return json({
          error: err instanceof Error ? err.message : "SQL failed",
          schema: analysisBaseSchemaText(),
          hint: "Fix SQL using the schema above; do not invent identifiers.",
        });
      }
    },
    {
      name: "analysis_sql",
      description:
        "Run one SQLite statement (SELECT/WITH, or CREATE/INSERT/DELETE/DROP on scratch_*/tmp_* only). Available only after analysis_schema. Max ~200 rows for SELECT.",
      schema: z.object({
        sql: z.string().min(1).max(12000),
      }),
    },
  );

  const analysis_write_csv = tool(
    async (input) => {
      await workspace.ensureReady();
      try {
        return json(workspace.writeCsvFromSql(input.fileName, input.sql));
      } catch (err) {
        return json({
          error: err instanceof Error ? err.message : "write_csv failed",
          schema: analysisBaseSchemaText(),
        });
      }
    },
    {
      name: "analysis_write_csv",
      description:
        "SELECT into a scratch CSV (available after analysis_schema). For chaining analyses.",
      schema: z.object({
        fileName: z.string().min(1).max(80).describe("Must end with .csv"),
        sql: z.string().min(1).max(12000),
      }),
    },
  );

  const analysis_list_files = tool(
    async () => {
      await workspace.ensureReady();
      return json({ files: workspace.listFiles() });
    },
    {
      name: "analysis_list_files",
      description: "List CSV/text files in the analysis scratchpad.",
      schema: z.object({}),
    },
  );

  const analysis_read_file = tool(
    async (input) => {
      await workspace.ensureReady();
      try {
        return json(workspace.readFile(input.fileName, input.maxChars ?? 8000));
      } catch (err) {
        return json({ error: err instanceof Error ? err.message : "read failed" });
      }
    },
    {
      name: "analysis_read_file",
      description: "Read a scratchpad file (CSV/text).",
      schema: z.object({
        fileName: z.string().min(1).max(80),
        maxChars: z.number().int().min(200).max(50_000).optional(),
      }),
    },
  );

  const analysis_load_csv = tool(
    async (input) => {
      await workspace.ensureReady();
      try {
        return json(workspace.loadCsvAsTable(input.fileName, input.table));
      } catch (err) {
        return json({ error: err instanceof Error ? err.message : "load_csv failed" });
      }
    },
    {
      name: "analysis_load_csv",
      description:
        "Load a scratch CSV into a scratch_*/tmp_* SQL table for further querying.",
      schema: z.object({
        fileName: z.string().min(1).max(80),
        table: z
          .string()
          .min(1)
          .max(80)
          .describe("Must start with scratch_ or tmp_"),
      }),
    },
  );

  return [
    analysis_schema,
    analysis_describe_table,
    analysis_sql,
    analysis_write_csv,
    analysis_list_files,
    analysis_read_file,
    analysis_load_csv,
  ];
}
