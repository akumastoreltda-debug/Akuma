import { deepStrictEqual, strictEqual } from "node:assert";
import express from "express";
import { request as httpRequest } from "node:http";
import { describe, it } from "node:test";
import {
  AMAZON_RETENTION_MIGRATION,
  AMAZON_RETENTION_REQUIRED_FUNCTIONS,
  type AmazonRetentionSchemaCheck,
} from "../lib/supabase";
import { createHealthRouter } from "./health";

type JsonRecord = Record<string, unknown>;

async function requestHealthAtPort(
  port: number,
): Promise<{ status: number; body: JsonRecord }> {
  return await new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: "127.0.0.1",
        port,
        path: "/healthz",
        method: "GET",
      },
      (response) => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          text += chunk;
        });
        response.on("end", () => {
          try {
            resolve({
              status: response.statusCode ?? 0,
              body: JSON.parse(text) as JsonRecord,
            });
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    request.on("error", reject);
    request.end();
  });
}

async function requestHealth(
  check: AmazonRetentionSchemaCheck,
): Promise<{ status: number; body: JsonRecord }> {
  const app = express();
  app.use(
    createHealthRouter({
      checkAmazonRetentionSchema: async () => check,
    }),
  );
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Test server did not expose a TCP address");
  }

  try {
    return await requestHealthAtPort(address.port);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

describe("health check remote retention status", () => {
  it("reports migration 0005 and its missing functions without failing liveness", async () => {
    const result = await requestHealth({
      complete: false,
      unavailable: false,
      missingFunctions: ["release_amazon_retention_lock", "prune_amazon_connection_tests"],
    });
    const retention = result.body.amazonRetention as JsonRecord;

    strictEqual(result.status, 200);
    strictEqual(result.body.status, "degraded");
    strictEqual(retention.status, "schema_incomplete");
    strictEqual(retention.migration, AMAZON_RETENTION_MIGRATION);
    deepStrictEqual(retention.requiredFunctions, [...AMAZON_RETENTION_REQUIRED_FUNCTIONS]);
    deepStrictEqual(retention.missingFunctions, [
      "release_amazon_retention_lock",
      "prune_amazon_connection_tests",
    ]);
    strictEqual(
      String(retention.diagnostic).includes(AMAZON_RETENTION_MIGRATION),
      true,
    );
    strictEqual(
      String(retention.diagnostic).includes("release_amazon_retention_lock"),
      true,
    );
    strictEqual(
      String(retention.diagnostic).includes("prune_amazon_connection_tests"),
      true,
    );
  });

  it("distinguishes invalid Supabase credentials from temporary unavailability", async () => {
    const cases: Array<{
      failureReason: "invalid_credentials" | "temporarily_unavailable";
      expectedStatus: string;
    }> = [
      {
        failureReason: "invalid_credentials",
        expectedStatus: "invalid_credentials",
      },
      {
        failureReason: "temporarily_unavailable",
        expectedStatus: "temporarily_unavailable",
      },
    ];

    for (const testCase of cases) {
      const result = await requestHealth({
        complete: false,
        unavailable: true,
        failureReason: testCase.failureReason,
        missingFunctions: [],
        diagnostic: "supabase-service-role-key-must-not-leak",
      });
      const retention = result.body.amazonRetention as JsonRecord;

      strictEqual(result.status, 200);
      strictEqual(result.body.status, "degraded");
      strictEqual(retention.status, testCase.expectedStatus);
      strictEqual(
        JSON.stringify(result.body).includes("supabase-service-role-key"),
        false,
      );
      deepStrictEqual(retention.missingFunctions, []);
    }
  });

  it("reports a ready remote retention contract as healthy", async () => {
    const result = await requestHealth({
      complete: true,
      unavailable: false,
      missingFunctions: [],
    });
    const retention = result.body.amazonRetention as JsonRecord;

    strictEqual(result.status, 200);
    strictEqual(result.body.status, "ok");
    strictEqual(retention.status, "ready");
    deepStrictEqual(retention.missingFunctions, []);
  });

  it("recovers from degraded to healthy without restarting the health router", async () => {
    let check: AmazonRetentionSchemaCheck = {
      complete: false,
      unavailable: false,
      missingFunctions: ["acquire_amazon_retention_lock"],
    };
    const app = express();
    app.use(
      createHealthRouter({
        checkAmazonRetentionSchema: async () => check,
      }),
    );
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      server.close();
      throw new Error("Test server did not expose a TCP address");
    }

    try {
      const degraded = await requestHealthAtPort(address.port);
      strictEqual(degraded.status, 200);
      strictEqual(degraded.body.status, "degraded");
      strictEqual(
        (degraded.body.amazonRetention as JsonRecord).status,
        "schema_incomplete",
      );

      check = {
        complete: true,
        unavailable: false,
        missingFunctions: [],
      };

      const recovered = await requestHealthAtPort(address.port);
      const retention = recovered.body.amazonRetention as JsonRecord;
      strictEqual(recovered.status, 200);
      strictEqual(recovered.body.status, "ok");
      strictEqual(retention.status, "ready");
      deepStrictEqual(retention.missingFunctions, []);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});