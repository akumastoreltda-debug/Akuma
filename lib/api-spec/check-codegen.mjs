import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const apiSpecDirectory = path.resolve(import.meta.dirname);
const workspaceRoot = process.env.CODEGEN_CHECK_WORKSPACE_ROOT
  ? path.resolve(process.env.CODEGEN_CHECK_WORKSPACE_ROOT)
  : path.resolve(apiSpecDirectory, "..", "..");
const currentCustomFetch = path.join(
  workspaceRoot,
  "lib",
  "api-client-react",
  "src",
  "custom-fetch.ts",
);
const generatedDirectories = [
  {
    name: "@workspace/api-client-react",
    current: path.join(
      workspaceRoot,
      "lib",
      "api-client-react",
      "src",
      "generated",
    ),
    generated: path.join("lib", "api-client-react", "src", "generated"),
  },
  {
    name: "@workspace/api-zod",
    current: path.join(workspaceRoot, "lib", "api-zod", "src", "generated"),
    generated: path.join("lib", "api-zod", "src", "generated"),
  },
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

async function readGeneratedFiles(directory) {
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

async function compareGeneratedDirectory({ name, current, generated }) {
  const [currentStats, generatedStats] = await Promise.all([
    stat(current).catch(() => null),
    stat(generated).catch(() => null),
  ]);

  if (!currentStats?.isDirectory()) {
    return [
      `${name}: missing current generated directory ${path.relative(workspaceRoot, current)}`,
    ];
  }
  if (!generatedStats?.isDirectory()) {
    return [
      `${name}: codegen did not produce ${path.relative(workspaceRoot, generated)}`,
    ];
  }

  const [currentFiles, generatedFiles] = await Promise.all([
    readGeneratedFiles(current),
    readGeneratedFiles(generated),
  ]);
  const differences = [];
  const allFiles = new Set([...currentFiles.keys(), ...generatedFiles.keys()]);

  for (const file of [...allFiles].sort()) {
    const currentContents = currentFiles.get(file);
    const generatedContents = generatedFiles.get(file);

    if (currentContents === undefined) {
      differences.push(
        `${name}: missing tracked output ${path.join(path.relative(workspaceRoot, current), file)}`,
      );
    } else if (generatedContents === undefined) {
      differences.push(
        `${name}: stale output no longer generated ${path.join(path.relative(workspaceRoot, current), file)}`,
      );
    } else if (currentContents !== generatedContents) {
      differences.push(
        `${name}: stale generated output ${path.join(path.relative(workspaceRoot, current), file)}`,
      );
    }
  }

  return differences;
}

async function prepareTemporarySources(outputRoot) {
  const temporaryCustomFetch = path.join(
    outputRoot,
    "lib",
    "api-client-react",
    "src",
    "custom-fetch.ts",
  );
  await mkdir(path.dirname(temporaryCustomFetch), { recursive: true });
  await copyFile(currentCustomFetch, temporaryCustomFetch);
  return temporaryCustomFetch;
}

function runCodegen(outputRoot, mutatorPath) {
  return new Promise((resolve, reject) => {
    const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
    const child = spawn(
      command,
      ["exec", "orval", "--config", "./orval.config.ts"],
      {
        cwd: apiSpecDirectory,
        env: {
          ...process.env,
          ORVAL_OUTPUT_ROOT: outputRoot,
          ORVAL_MUTATOR_PATH: mutatorPath,
        },
        stdio: "inherit",
      },
    );

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `Orval codegen failed${signal ? ` with signal ${signal}` : ` with exit code ${code}`}.`,
          ),
        );
      }
    });
  });
}

const temporaryDirectory = await mkdtemp(
  path.join(os.tmpdir(), "api-codegen-check-"),
);

try {
  console.log("[contracts] Checking generated outputs.");
  const temporaryCustomFetch =
    await prepareTemporarySources(temporaryDirectory);
  await runCodegen(temporaryDirectory, temporaryCustomFetch);
  const differences = (
    await Promise.all(
      generatedDirectories.map((directory) =>
        compareGeneratedDirectory({
          ...directory,
          generated: path.join(temporaryDirectory, directory.generated),
        }),
      ),
    )
  ).flat();

  if (differences.length > 0) {
    console.error(
      [
        "[contracts] FAILED: generated output verification.",
        ...differences.map((difference) => `- ${difference}`),
        "[contracts] Failed command: pnpm --filter @workspace/api-spec run codegen:check",
        "[contracts] Reproduce locally with: pnpm run contracts:check",
        "Run `pnpm --filter @workspace/api-spec run codegen` to regenerate them.",
        "The check generated into a temporary directory and did not modify the working tree.",
      ].join("\n"),
    );
    process.exitCode = 1;
  } else {
    console.log("[contracts] Generated outputs are up to date.");
  }
} catch (error) {
  console.error("[contracts] FAILED: generated output verification.");
  console.error(
    "[contracts] Failed command: pnpm --filter @workspace/api-spec run codegen:check",
  );
  console.error(
    "[contracts] Reproduce locally with: pnpm run contracts:check",
  );
  throw error;
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
