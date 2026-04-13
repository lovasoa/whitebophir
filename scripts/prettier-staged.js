"use strict";

const { execFileSync } = require("node:child_process");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const prettierBin = path.join(
  repoRoot,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "prettier.cmd" : "prettier",
);

function getStagedFiles() {
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
}

const files = getStagedFiles();
if (files.length === 0) {
  process.exit(0);
}

execFileSync(prettierBin, ["--write", ...files], {
  cwd: repoRoot,
  stdio: "inherit",
});

execFileSync("git", ["add", "--", ...files], {
  cwd: repoRoot,
  stdio: "inherit",
});
