import { build } from "esbuild";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const artifactDir = path.dirname(fileURLToPath(import.meta.url));
const testDir = path.join(artifactDir, ".test-dist");
const testEntries = [
  {
    source: path.join(artifactDir, "src/lib/amazon-sp-api.test.ts"),
    output: path.join(testDir, "amazon-sp-api.test.mjs"),
  },
  {
    source: path.join(artifactDir, "src/routes/amazon-history.test.ts"),
    output: path.join(testDir, "amazon-history.test.mjs"),
  },
  {
    source: path.join(artifactDir, "src/routes/amazon-schema.test.ts"),
    output: path.join(testDir, "amazon-schema.test.mjs"),
  },
  {
    source: path.join(artifactDir, "src/routes/amazon-ownership.test.ts"),
    output: path.join(testDir, "amazon-ownership.test.mjs"),
  },
  {
    source: path.join(artifactDir, "src/routes/amazon-owner-transfer.test.ts"),
    output: path.join(testDir, "amazon-owner-transfer.test.mjs"),
  },
  {
    source: path.join(artifactDir, "src/routes/alerts.test.ts"),
    output: path.join(testDir, "alerts.test.mjs"),
  },
  {
    source: path.join(artifactDir, "src/routes/dashboard.test.ts"),
    output: path.join(testDir, "dashboard.test.mjs"),
  },
  {
    source: path.join(artifactDir, "src/routes/amazon-retention.test.ts"),
    output: path.join(testDir, "amazon-retention.test.mjs"),
  },
  {
    source: path.join(artifactDir, "src/routes/health.test.ts"),
    output: path.join(testDir, "health.test.mjs"),
  },
];

await rm(testDir, { recursive: true, force: true });
await Promise.all(
  testEntries.map(({ source, output }) =>
    build({
      entryPoints: [source],
      bundle: true,
      platform: "node",
      format: "esm",
      outfile: output,
      sourcemap: "inline",
      external: [
        "@replit/connectors-sdk",
        "express",
        "@clerk/express",
        "pino",
        "pino-http",
      ],
    }),
  ),
);

const result = spawnSync(
  process.execPath,
  ["--test", ...testEntries.map(({ output }) => output)],
  {
  stdio: "inherit",
  },
);
process.exit(result.status ?? 1);
