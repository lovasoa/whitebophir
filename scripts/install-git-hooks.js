const { execFileSync } = require("node:child_process");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const hooksPath = ".githooks";

try {
  execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd: repoRoot,
    stdio: "ignore",
  });
  execFileSync("git", ["config", "--local", "core.hooksPath", hooksPath], {
    cwd: repoRoot,
    stdio: "ignore",
  });
} catch (_error) {
  // Ignore non-git installs, such as tarball packaging.
}
