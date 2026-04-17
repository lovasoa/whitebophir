import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const profileDir = path.join(repoRoot, ".profiles");
const benchmarkScript = path.join(repoRoot, "scripts/benchmark-server.mjs");
const profileFiles = [
  "benchmark-server.cpuprofile",
  "benchmark-server.heapprofile",
];
const spawnArgs = [
  "--expose-gc",
  "--cpu-prof",
  `--cpu-prof-dir=${profileDir}`,
  "--cpu-prof-name=benchmark-server.cpuprofile",
  "--heap-prof",
  `--heap-prof-dir=${profileDir}`,
  "--heap-prof-name=benchmark-server.heapprofile",
  benchmarkScript,
];
const benchmarkTimeoutMs = process.env.WBO_BENCH_TIMEOUT_MS ?? "600000";

fs.mkdirSync(profileDir, { recursive: true });

for (const fileName of profileFiles) {
  fs.rmSync(path.join(profileDir, fileName), { force: true });
}

const result = spawnSync(process.execPath, spawnArgs, {
  cwd: repoRoot,
  env: {
    ...process.env,
    WBO_BENCH_TIMEOUT_MS: benchmarkTimeoutMs,
  },
  stdio: "inherit",
});

if (result.error) {
  throw result.error;
}

if (result.signal) {
  console.error(`benchmark profiler exited from signal ${result.signal}`);
  process.exit(1);
}

const exitCode = result.status ?? 1;
process.exit(exitCode);
