import { deepStrictEqual, strictEqual } from "node:assert";
import { describe, it } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AmazonSchemaIssueCard } from "../components/amazon-schema-issue";
import { nextAmazonSchemaIssue, readAmazonSchemaIssue } from "./amazon-schema";

describe("Amazon schema issue presentation", () => {
  it("keeps only safe schema diagnostics from an API error", () => {
    const issue = readAmazonSchemaIssue({
      data: {
        code: "AMAZON_SCHEMA_INCOMPLETE",
        error: "Aplique a migration indicada.",
        missingTables: ["amazon_sync_runs"],
        missingFunctions: ["acquire_amazon_sync_lock"],
        missingColumns: [
          {
            table: "sales",
            column: "updated_at",
            migration: "0002_amazon_selling_partner.sql",
          },
          {
            table: "",
            column: "ignored",
            migration: "0002_amazon_selling_partner.sql",
          },
        ],
        clientSecret: "client-secret",
        serviceRoleKey: "supabase-service-role-key",
      },
    });

    strictEqual(issue?.code, "AMAZON_SCHEMA_INCOMPLETE");
    deepStrictEqual(issue?.missingColumns, [
      {
        table: "sales",
        column: "updated_at",
        migration: "0002_amazon_selling_partner.sql",
      },
    ]);
    strictEqual(JSON.stringify(issue).includes("client-secret"), false);
    strictEqual(JSON.stringify(issue).includes("supabase-service-role-key"), false);
  });

  it("renders both schema states and never renders credentials", () => {
    const incomplete = readAmazonSchemaIssue({
      data: {
        code: "AMAZON_SCHEMA_INCOMPLETE",
        error: "Schema incompleto",
        missingTables: [],
        missingFunctions: [],
        missingColumns: [
          {
            table: "sales",
            column: "updated_at",
            migration: "0002_amazon_selling_partner.sql",
          },
        ],
        refreshToken: "Atzr|refresh-token",
      },
    });
    const unavailable = readAmazonSchemaIssue({
      data: {
        code: "SUPABASE_SCHEMA_UNAVAILABLE",
        error: "Schema indisponível",
        missingTables: [],
        missingFunctions: [],
        missingColumns: [],
        serviceRoleKey: "supabase-service-role-key",
      },
    });
    if (!incomplete || !unavailable) throw new Error("Expected both schema issues");

    const incompleteMarkup = renderToStaticMarkup(
      <AmazonSchemaIssueCard issue={incomplete} />,
    );
    const unavailableMarkup = renderToStaticMarkup(
      <AmazonSchemaIssueCard issue={unavailable} />,
    );

    strictEqual(incompleteMarkup.includes("Schema Amazon incompleto"), true);
    strictEqual(incompleteMarkup.includes("Colunas ausentes"), true);
    strictEqual(incompleteMarkup.includes("sales.updated_at"), true);
    strictEqual(incompleteMarkup.includes("0002_amazon_selling_partner.sql"), true);
    strictEqual(incompleteMarkup.includes("Atzr|refresh-token"), false);
    strictEqual(unavailableMarkup.includes("Schema do Supabase indisponível"), true);
    strictEqual(unavailableMarkup.includes("Colunas ausentes"), false);
    strictEqual(unavailableMarkup.includes("supabase-service-role-key"), false);
  });

  it("clears the previous schema diagnosis after a successful synchronization", () => {
    let issue = nextAmazonSchemaIssue({
      type: "error",
      error: {
        data: {
          code: "AMAZON_SCHEMA_INCOMPLETE",
          error: "Schema incompleto: client-secret",
          missingTables: ["amazon_sync_runs"],
          missingFunctions: [],
          missingColumns: [],
          serviceRoleKey: "supabase-service-role-key",
        },
      },
    });
    if (!issue) throw new Error("Expected the initial schema issue");

    const beforeSuccess = renderToStaticMarkup(
      <AmazonSchemaIssueCard issue={issue} />,
    );
    issue = nextAmazonSchemaIssue({ type: "success" });
    const afterSuccessMarkup = issue
      ? renderToStaticMarkup(<AmazonSchemaIssueCard issue={issue} />)
      : "";

    strictEqual(beforeSuccess.includes("Schema Amazon incompleto"), true);
    strictEqual(beforeSuccess.includes("client-secret"), false);
    strictEqual(beforeSuccess.includes("supabase-service-role-key"), false);
    strictEqual(issue, null);
    strictEqual(afterSuccessMarkup, "");
    strictEqual(afterSuccessMarkup.includes("client-secret"), false);
    strictEqual(afterSuccessMarkup.includes("supabase-service-role-key"), false);
  });
});