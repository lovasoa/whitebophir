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
const requestedScenario = (process.argv[2] || "all").toLowerCase();
const scenarios =
  requestedScenario === "all"
    ? ["e2e", "load", "persist", "broadcast"]
    : [requestedScenario];
const benchmarkTimeoutMs = process.env.WBO_BENCH_TIMEOUT_MS ?? "600000";

fs.mkdirSync(profileDir, { recursive: true });

for (const scenario of scenarios) {
  const cpuName =
    scenarios.length === 1
      ? "benchmark-server.cpuprofile"
      : `benchmark-server-${scenario}.cpuprofile`;
  const heapName =
    scenarios.length === 1
      ? "benchmark-server.heapprofile"
      : `benchmark-server-${scenario}.heapprofile`;
  const cpuPath = path.join(profileDir, cpuName);
  const heapPath = path.join(profileDir, heapName);

  fs.rmSync(cpuPath, { force: true });
  fs.rmSync(heapPath, { force: true });

  const result = spawnSync(
    process.execPath,
    ["--expose-gc", benchmarkScript, scenario],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        WBO_BENCH_TIMEOUT_MS: benchmarkTimeoutMs,
        WBO_PROFILE_CPU_OUT: cpuPath,
        WBO_PROFILE_HEAP_OUT: heapPath,
      },
      stdio: "inherit",
    },
  );

  if (result.error) {
    throw result.error;
  }
  if (result.signal) {
    console.error(`benchmark profiler exited from signal ${result.signal}`);
    process.exit(1);
  }
  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
}
