export type AmazonSchemaIssueCode =
  | "AMAZON_SCHEMA_INCOMPLETE"
  | "SUPABASE_SCHEMA_UNAVAILABLE";

export type AmazonSchemaIssue = {
  code: AmazonSchemaIssueCode;
  message: string;
  missingTables: string[];
  missingFunctions: string[];
  missingColumns: Array<{
    table: string;
    column: string;
    migration: string;
  }>;
};

export type AmazonSchemaIssueOutcome =
  | { type: "success" }
  | { type: "error"; error: unknown };

export function readAmazonSchemaIssue(error: unknown): AmazonSchemaIssue | null {
  if (!error || typeof error !== "object" || !("data" in error)) return null;

  const data = (error as { data?: unknown }).data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;

  const payload = data as Record<string, unknown>;
  const code = payload.code;
  if (code !== "AMAZON_SCHEMA_INCOMPLETE" && code !== "SUPABASE_SCHEMA_UNAVAILABLE") {
    return null;
  }

  const readStringArray = (value: unknown) =>
    Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
      : [];
  const missingColumns = Array.isArray(payload.missingColumns)
    ? payload.missingColumns.flatMap((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return [];
        const column = item as Record<string, unknown>;
        if (
          typeof column.table !== "string" ||
          typeof column.column !== "string" ||
          typeof column.migration !== "string" ||
          !column.table ||
          !column.column ||
          !column.migration
        ) {
          return [];
        }
        return [{
          table: column.table,
          column: column.column,
          migration: column.migration,
        }];
      })
    : [];

  return {
    code,
    message: typeof payload.error === "string" ? payload.error : "Não foi possível verificar o schema do banco.",
    missingTables: readStringArray(payload.missingTables),
    missingFunctions: readStringArray(payload.missingFunctions),
    missingColumns,
  };
}

export function nextAmazonSchemaIssue(
  outcome: AmazonSchemaIssueOutcome,
): AmazonSchemaIssue | null {
  return outcome.type === "success" ? null : readAmazonSchemaIssue(outcome.error);
}