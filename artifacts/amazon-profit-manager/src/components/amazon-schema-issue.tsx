import * as React from "react";
import { AlertTriangle } from "lucide-react";
import type { AmazonSchemaIssue } from "../lib/amazon-schema";

export function AmazonSchemaIssueCard({ issue }: { issue: AmazonSchemaIssue }) {
  const isIncomplete = issue.code === "AMAZON_SCHEMA_INCOMPLETE";

  return (
    <section className={`mb-6 rounded-xl border p-6 ${
      isIncomplete
        ? "border-amber-500/30 bg-amber-500/5"
        : "border-destructive/20 bg-destructive/5"
    }`}>
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
          isIncomplete
            ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
            : "bg-destructive/10 text-destructive"
        }`}>
          <AlertTriangle size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold">
            {isIncomplete
              ? "Schema Amazon incompleto"
              : "Schema do Supabase indisponível"}
          </h3>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {isIncomplete
              ? "A sincronização não foi iniciada porque faltam estruturas no banco remoto. Aplique as migrations indicadas e tente novamente."
              : "Não foi possível verificar o schema do banco remoto. Confirme que o projeto configurado está disponível e tente novamente."}
          </p>

          {isIncomplete && (
            <div className="mt-4 space-y-4">
              {issue.missingColumns.length > 0 && (
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Colunas ausentes
                  </p>
                  <div className="mt-2 overflow-hidden rounded-lg border border-border/80 bg-background/70">
                    <div className="divide-y divide-border/70">
                      {issue.missingColumns.map(({ table, column, migration }) => (
                        <div key={`${table}.${column}.${migration}`} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-3 py-2.5 text-xs">
                          <span className="font-mono font-semibold">{table}.{column}</span>
                          <span className="text-muted-foreground">
                            Migration: <span className="font-mono">{migration}</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {issue.missingTables.length > 0 && (
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Tabelas ausentes
                  </p>
                  <p className="mt-2 font-mono text-xs text-muted-foreground">
                    {issue.missingTables.join(", ")}
                  </p>
                </div>
              )}

              {issue.missingFunctions.length > 0 && (
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Funções ausentes
                  </p>
                  <p className="mt-2 font-mono text-xs text-muted-foreground">
                    {issue.missingFunctions.join(", ")}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}