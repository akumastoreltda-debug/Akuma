import { deepStrictEqual, match, notStrictEqual, strictEqual } from "node:assert";
import { execFileSync } from "node:child_process";
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

const apiSpecDirectory = path.resolve(import.meta.dirname);
const workspaceRoot = path.resolve(apiSpecDirectory, "..", "..");
const checkerPath = path.join(apiSpecDirectory, "check-codegen.mjs");
const generatedDirectories = [
  "lib/api-client-react/src/generated",
  "lib/api-zod/src/generated",
];

async function listFiles(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(
        ...(await listFiles(entryPath, path.join(prefix, entry.name))),
      );
    } else if (entry.isFile()) {
      files.push(path.join(prefix, entry.name));
    }
  }

  return files.sort();
}

async function readFiles(directory) {
  const files = await listFiles(directory);
  return new Map(
    await Promise.all(
      files.map(async (file) => [
        file,
        await readFile(path.join(directory, file), "utf8"),
      ]),
    ),
  );
}

async function copyGeneratedOutputs(fixtureRoot) {
  await Promise.all(
    generatedDirectories.map((directory) =>
      cp(
        path.join(workspaceRoot, directory),
        path.join(fixtureRoot, directory),
        { recursive: true },
      ),
    ),
  );
  await cp(
    path.join(workspaceRoot, "lib/api-client-react/src/custom-fetch.ts"),
    path.join(fixtureRoot, "lib/api-client-react/src/custom-fetch.ts"),
  );
}

async function snapshotWorkspaceOutputs() {
  const snapshots = new Map();
  for (const directory of generatedDirectories) {
    snapshots.set(
      directory,
      await readFiles(path.join(workspaceRoot, directory)),
    );
  }
  return snapshots;
}

async function runChecker(fixtureRoot) {
  try {
    execFileSync(process.execPath, [checkerPath], {
      cwd: apiSpecDirectory,
      env: {
        ...process.env,
        CODEGEN_CHECK_WORKSPACE_ROOT: fixtureRoot,
      },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, stdout: "", stderr: "" };
  } catch (error) {
    return {
      status: error.status ?? null,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
    };
  }
}

describe("codegen check", () => {
  it("reports altered generated fixtures without modifying workspace outputs", async () => {
    const fixtureRoot = await mkdtemp(
      path.join(os.tmpdir(), "api-codegen-check-fixture-"),
    );
    const workspaceBefore = await snapshotWorkspaceOutputs();

    try {
      await copyGeneratedOutputs(fixtureRoot);
      const alteredOutput = path.join(
        fixtureRoot,
        "lib/api-client-react/src/generated/api.ts",
      );
      const originalAlteredOutput = await readFile(alteredOutput, "utf8");
      await writeFile(
        alteredOutput,
        `${originalAlteredOutput}\n// intentionally stale fixture\n`,
      );

      const result = await runChecker(fixtureRoot);
      const outputPath = "lib/api-client-react/src/generated/api.ts";

      notStrictEqual(result.status, 0);
      match(
        result.stderr,
        /\[contracts\] FAILED: generated output verification\./,
      );
      match(result.stderr, new RegExp(`stale generated output .*${outputPath}`));
      match(
        result.stderr,
        /Run `pnpm --filter @workspace\/api-spec run codegen` to regenerate them\./,
      );
      match(
        result.stderr,
        /The check generated into a temporary directory and did not modify the working tree\./,
      );

      const workspaceAfter = await snapshotWorkspaceOutputs();
      deepStrictEqual(workspaceAfter, workspaceBefore);
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("reports removed generated fixture outputs", async () => {
    const fixtureRoot = await mkdtemp(
      path.join(os.tmpdir(), "api-codegen-check-fixture-"),
    );

    try {
      await copyGeneratedOutputs(fixtureRoot);
      await rm(
        path.join(
          fixtureRoot,
          "lib/api-client-react/src/generated/api.schemas.ts",
        ),
      );

      const result = await runChecker(fixtureRoot);

      notStrictEqual(result.status, 0);
      match(
        result.stderr,
        /\[contracts\] FAILED: generated output verification\./,
      );
      match(
        result.stderr,
        /missing tracked output lib\/api-client-react\/src\/generated\/api\.schemas\.ts/,
      );
      strictEqual(
        result.stderr.includes(
          "[contracts] FAILED: generated output verification.",
        ),
        true,
      );
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });
});