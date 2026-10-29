import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const biomeBin = path.join(
  repoRoot,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "biome.cmd" : "biome",
);

const getStagedFiles = () => {
  const output = execFileSync(
    "git",
    ["diff", "--cached", "--name-only", "--diff-filter=ACMR"],
    { cwd: repoRoot, encoding: "utf8" },
  );
  return output
    .split("\n")
    .map((file) => file.trim())
    .filter(Boolean)
    .filter((file) => !file.startsWith(".githooks/"));
};

const files = getStagedFiles();
if (files.length === 0) {
  process.exit(0);
}

execFileSync(
  biomeBin,
  [
    "check",
    "--write",
    "--unsafe",
    "--assist-enabled=false",
    "--files-ignore-unknown=true",
    "--no-errors-on-unmatched",
    ...files,
  ],
  {
    cwd: repoRoot,
    stdio: "inherit",
  },
);

execFileSync("git", ["add", "--", ...files], {
  cwd: repoRoot,
  stdio: "inherit",
});
