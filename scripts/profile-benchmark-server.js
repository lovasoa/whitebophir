const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..");
const profileDir = path.join(repoRoot, ".profiles");
const benchmarkScript = path.join(repoRoot, "scripts/benchmark-server.js");
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

fs.mkdirSync(profileDir, { recursive: true });

for (const fileName of profileFiles) {
  fs.rmSync(path.join(profileDir, fileName), { force: true });
}

const result = spawnSync(process.execPath, spawnArgs, {
  cwd: repoRoot,
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
